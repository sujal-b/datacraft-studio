from celery import Celery
import pandas as pd
import numpy as np
import os
import json
from redis import Redis
from datetime import datetime, timezone
from scipy import stats
from statsmodels.tsa.stattools import acf
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from ai_service import get_ai_interpretation
from data_type_detector import detect_data_type

celery_app = Celery('tasks', broker='redis://localhost:6379/0', backend='redis://localhost:6379/0')
redis_cache = Redis(host='localhost', port=6379, db=1, decode_responses=True)

@celery_app.task
def generate_dataset_summary(file_path: str):
    try:
        file_name = os.path.basename(file_path)
        common_na_values = ['', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan',
                            '1.#IND', '1.#QNAN', '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'n/a',
                            'nan', 'null', 'None']
        df = pd.read_csv(file_path, on_bad_lines='skip', na_values=common_na_values)
        
        if df.empty:
            redis_cache.hdel("dashboard_summaries", file_name)
            return

        column_types = {}
        for column in df.columns:
            column_types[column] = detect_data_type(df[column])

        rows, columns = df.shape
        missing_cells = df.isnull().sum().sum()
        total_cells = rows * columns if rows > 0 and columns > 0 else 1
        missing_pct = (missing_cells / total_cells) * 100
        duplicate_rows = df.duplicated().sum()
        duplicate_pct = (duplicate_rows / rows) * 100 if rows > 0 else 0
        inconsistent_rows = 0
        text_cols = df.select_dtypes(include=['object']).columns
        if not text_cols.empty:
            whitespace_issues = df[text_cols].apply(lambda x: x.str.strip() != x, axis=1).any(axis=1)
            inconsistent_rows = whitespace_issues.sum()
        inconsistency_pct = (inconsistent_rows / rows) * 100 if rows > 0 else 0
        quality_score = max(0, 100 - missing_pct - duplicate_pct - inconsistency_pct)
        
        status = "RAW"
        if quality_score > 90: status = "CLEANED"
        elif quality_score > 60: status = "CLEANING"
        
        summary = {
            "id": file_name, "filename": file_name,
            "size": f"{os.path.getsize(file_path) / (1024*1024):.1f}MB",
            "rows": rows, "columns": columns, "status": status,
            "qualityScore": round(quality_score), "missing": round(missing_pct),
            "duplicates": round(duplicate_pct), "inconsistencies": round(inconsistency_pct),
            "lastModified": datetime.fromtimestamp(os.path.getmtime(file_path)).strftime('%Y-%m-%d'),
            "column_types": column_types
        }
        redis_cache.hset("dashboard_summaries", file_name, json.dumps(summary))
    except Exception as e:
        print(f"CRITICAL ERROR in generate_dataset_summary for {file_path}: {e}")

@celery_app.task
def generate_dataset_statistics(file_path: str):
    try:
        df = pd.read_csv(file_path, on_bad_lines='skip')
        if df.empty:
            return {"status": "ERROR", "message": "Dataset is empty."}
        rows, cols = df.shape
        total_cells = rows * cols
        column_stats = []
        for header in df.columns:
            series = df[header]
            clean_series = series.dropna()
            is_numeric = pd.api.types.is_numeric_dtype(clean_series)
            null_count = int(series.isnull().sum())
            stat = {
                "column": header,
                "totalValues": len(clean_series),
                "nullCount": null_count,
                "nullPercentage": (null_count / rows) * 100 if rows > 0 else 0,
                "uniqueValues": series.nunique(),
                "dataType": "Numeric" if is_numeric else "Text",
                "mean": "N/A", "median": "N/A", "mode": "N/A"
            }
            if is_numeric and not clean_series.empty:
                stat["mean"] = round(clean_series.mean(), 2)
                stat["median"] = round(clean_series.median(), 2)
                modes = clean_series.mode()
                if not modes.empty:
                    mode_str = ", ".join(modes.astype(str).tolist())
                    if len(mode_str) > 30:
                        mode_str = mode_str[:27] + "..."
                    stat["mode"] = mode_str
            column_stats.append(stat)
        overall_null_count = sum(s['nullCount'] for s in column_stats)
        data_quality = ((total_cells - overall_null_count) / total_cells) * 100 if total_cells > 0 else 0
        result = {
            "totalRows": rows, "totalColumns": cols, "totalCells": total_cells,
            "overallNullCount": overall_null_count, "dataQuality": data_quality,
            "columnStats": column_stats
        }
        return {"status": "SUCCESS", "result": result}
    except Exception as e:
        return {"status": "FAILURE", "error": str(e)}

def get_temporal_profile(df: pd.DataFrame, col: str) -> dict:
    time_cols = [c for c in df.columns if 'time' in c.lower() or 'date' in c.lower()]
    if not time_cols:
        return {"is_time_series": False}
    time_col = time_cols[0]
    try:
        ts_data = pd.to_datetime(df[time_col], errors='coerce').dropna()
        if ts_data.empty: return {"is_time_series": False}
    except Exception:
        return {"is_time_series": False}
    ts_series = df.set_index(time_col)[col].sort_index().dropna()
    acf_1 = None
    if ts_series.nunique() > 1 and len(ts_series) > 1:
        try:
            acf_1 = round(acf(ts_series, nlags=1, fft=False)[1], 2)
        except Exception:
            acf_1 = None
    return {"is_time_series": True, "temporal_stability_acf1": acf_1}

def get_mnar_indicators(df: pd.DataFrame, col: str) -> dict:
    correlations = {}
    missing_indicator = df[col].isnull().astype(int)
    for other_col in df.columns:
        if other_col == col: continue
        try:
            if pd.api.types.is_numeric_dtype(df[other_col]) and df[other_col].nunique() > 1:
                corr = missing_indicator.corr(df[other_col])
                if pd.notnull(corr) and abs(corr) > 0.3:
                    correlations[other_col] = round(corr, 2)
        except Exception:
            continue
    return correlations

def get_statistical_profile(df: pd.DataFrame, column_name: str) -> dict:
    detected_type = detect_data_type(df[column_name])

    missing_count = int(df[column_name].isnull().sum())
    total_count = len(df[column_name])
    missing_pct = (missing_count / total_count) * 100 if total_count > 0 else 0

    profile = {
        "column": column_name,
        "missing_count": missing_count, 
        "missing_pct": round(missing_pct, 4),
        "data_type": detected_type,
        "unique_values": df[column_name].nunique()
    }
    if detected_type in ['integer', 'float', 'identifier']:
        clean_data = df[column_name].dropna()
        if not clean_data.empty:
            profile["mean"] = round(clean_data.mean(), 2)
            profile["median"] = round(clean_data.median(), 2)
    profile["mnar_indicators"] = get_mnar_indicators(df, column_name)
    profile.update(get_temporal_profile(df, column_name))
    return profile

def perform_standardization(df: pd.DataFrame, column_name: str, method: str, file_path: str) -> dict:
    new_col_name = f"{column_name}_{method}_scaled"
    if new_col_name in df.columns:
        return {"status": "SKIPPED", "message": f"Column '{new_col_name}' already exists."}
    if not pd.api.types.is_numeric_dtype(df[column_name]):
        raise ValueError(f"Column '{column_name}' is not numeric.")
    if df[column_name].isnull().any():
        raise ValueError(f"Column '{column_name}' contains missing values. Impute first.")
    scaler = StandardScaler() if method == 'standard' else MinMaxScaler()
    df[new_col_name] = scaler.fit_transform(df[[column_name]].values.astype(np.float32))
    df.to_csv(file_path, index=False)
    q1 = float(df[column_name].quantile(0.25))
    q3 = float(df[column_name].quantile(0.75))
    audit_report = {
        "new_column_added": new_col_name, "message": f"Successfully created new column: '{new_col_name}'.",
        "method": method, "timestamp_utc": datetime.now(timezone.utc).isoformat(), "row_count_affected": len(df),
        "input_stats_robust": {"median": float(df[column_name].median()), "interquartile_range": q3 - q1}
    }
    return audit_report

def perform_delete_column(df: pd.DataFrame, column_name: str, file_path: str):
    if column_name not in df.columns:
        raise ValueError(f"Column '{column_name}' not found.")
    df.drop(columns=[column_name], inplace=True)
    df.to_csv(file_path, index=False)
    return {"message": f"Successfully deleted column '{column_name}' and updated the dataset."}


@celery_app.task
def route_task(dataset_name: str, column_name: str, task_type: str, task_params: dict = None):
    try:
        file_path = os.path.join(os.path.dirname(__file__), '..', 'public', dataset_name)
        df = pd.read_csv(file_path)
        if task_type == 'diagnosis':
            profile = get_statistical_profile(df, column_name)
            result = get_ai_interpretation(profile)
            return {"status": "SUCCESS", "result": result}
        elif task_type == 'delete_column':
            result = perform_delete_column(df, column_name, file_path)
            return {"status": "SUCCESS", "result": result}
        elif task_type in ['standard_scale', 'minmax_scale']:
            method = 'standard' if task_type == 'standard_scale' else 'minmax'
            result = perform_standardization(df, column_name, method, file_path)
            return {"status": "SUCCESS", "result": result}
        else:
            return {"status": "ERROR", "message": "Unknown task type."}
    except Exception as e:
        return {"status": "FAILURE", "error": str(e)}
    
@celery_app.task
def perform_dataset_cleaning_task(file_path: str, action_type: str):
    """
    Performs a dataset-wide cleaning action based on the specified action_type.
    This task modifies the dataset file in place.
    """
    try:
        if not os.path.exists(file_path):
            return {"status": "FAILURE", "error": "File not found."}

        df = pd.read_csv(file_path, on_bad_lines='skip')
        original_rows = len(df)

        if action_type == 'drop_na_rows':
            df.dropna(inplace=True)
            rows_affected = original_rows - len(df)
            message = f"Successfully dropped {rows_affected} rows with missing values."
        
        elif action_type == 'drop_duplicate_rows':
            df.drop_duplicates(inplace=True)
            rows_affected = original_rows - len(df)
            message = f"Successfully dropped {rows_affected} duplicate rows."
            
        else:
            return {"status": "FAILURE", "error": f"Unknown cleaning action: {action_type}"}

        # Overwrite the original file with the cleaned data
        df.to_csv(file_path, index=False)

        return {"status": "SUCCESS", "message": message, "rows_affected": rows_affected}

    except Exception as e:
        print(f"CRITICAL ERROR in perform_dataset_cleaning_task for {file_path}: {e}")
        return {"status": "FAILURE", "error": str(e)}