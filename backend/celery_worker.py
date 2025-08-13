# backend/celery_worker.py
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
redis_cache = Redis(host='localhost', port=6379, db=1, decode_responses=True) #DashBoard cache

@celery_app.task
def generate_dataset_summary(file_path: str):
    """
    Performs a full, robust analysis on a single dataset and saves the
    summary to a persistent Redis cache. This is the heavy lifting, done asynchronously.
    """
    try:
        file_name = os.path.basename(file_path)
        print(f"BACKGROUND JOB: Generating dashboard summary for '{file_name}'...")
        
        # PROFESSIONAL FIX: A robust list of values pandas should treat as null.
        # This is the key to accurately detecting all missing values.
        common_na_values = ['', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan',
                            '1.#IND', '1.#QNAN', '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'n/a',
                            'nan', 'null', 'None']
        
        df = pd.read_csv(file_path, on_bad_lines='skip', na_values=common_na_values)
        
        if df.empty:
            redis_cache.hdel("dashboard_summaries", file_name)
            return

        rows, columns = df.shape
        
        # --- ACCURATE METRIC CALCULATIONS ---
        
        # 1. Missing Values (Now works correctly for all null types)
        missing_cells = df.isnull().sum().sum()
        total_cells = rows * columns if rows > 0 and columns > 0 else 1
        missing_pct = (missing_cells / total_cells) * 100
        
        # 2. Duplicate Rows
        duplicate_rows = df.duplicated().sum()
        duplicate_pct = (duplicate_rows / rows) * 100 if rows > 0 else 0
        
        # 3. Inconsistencies (More robust definition: leading/trailing whitespace)
        inconsistent_rows = 0
        text_cols = df.select_dtypes(include=['object']).columns
        if not text_cols.empty:
            # This creates a boolean mask for rows that have at least one cell with whitespace issues.
            whitespace_issues = df[text_cols].apply(lambda x: x.str.strip() != x, axis=1).any(axis=1)
            inconsistent_rows = whitespace_issues.sum()
        inconsistency_pct = (inconsistent_rows / rows) * 100 if rows > 0 else 0

        quality_score = max(0, 100 - missing_pct - duplicate_pct - inconsistency_pct)
        
        status = "RAW"
        if quality_score > 90: status = "CLEANED"
        elif quality_score > 60: status = "CLEANING"

        summary = {
            "id": file_name,
            "filename": file_name,
            "size": f"{os.path.getsize(file_path) / (1024*1024):.1f}MB",
            "rows": rows, "columns": columns, "status": status,
            "qualityScore": round(quality_score),
            "missing": round(missing_pct),
            "duplicates": round(duplicate_pct),
            "inconsistencies": round(inconsistency_pct),
            "lastModified": datetime.fromtimestamp(os.path.getmtime(file_path)).strftime('%Y-%m-%d')
        }
        
        # Save the final summary to the Redis hash cache.
        redis_cache.hset("dashboard_summaries", file_name, json.dumps(summary))
        print(f"BACKGROUND JOB: Successfully cached summary for '{file_name}'.")

    except Exception as e:
        print(f"CRITICAL ERROR in generate_dataset_summary for {file_path}: {e}")

def get_temporal_profile(df: pd.DataFrame, col: str) -> dict:
    """
    Robustly detects and analyzes time-series properties.
    """
    # Flaw 1 Fix: More robust time column detection and validation
    time_cols = [c for c in df.columns if 'time' in c.lower() or 'date' in c.lower()]
    if not time_cols:
        return {"is_time_series": False}

    time_col = time_cols[0]
    try:
        # Attempt to convert to datetime; if it fails, it's not a real time series
        ts_data = pd.to_datetime(df[time_col], errors='coerce').dropna()
        if ts_data.empty: return {"is_time_series": False}
    except Exception:
        return {"is_time_series": False}

    # Flaw 2 Fix: Add guardrails to ACF calculation
    ts_series = df.set_index(time_col)[col].sort_index().dropna()
    acf_1 = None
    if ts_series.nunique() > 1 and len(ts_series) > 1: # Check for constant series and sufficient data
        try:
            acf_1 = round(acf(ts_series, nlags=1, fft=False)[1], 2)
        except Exception:
            acf_1 = None # Calculation can fail on unusual data

    return {
        "is_time_series": True,
        "temporal_stability_acf1": acf_1
    }

def get_mnar_indicators(df: pd.DataFrame, col: str) -> dict:
    """
    More robust MNAR indicator analysis.
    """
    correlations = {}
    missing_indicator = df[col].isnull().astype(int)

    # Flaw 3 Fix (Partial): Analyze correlations with numeric AND categorical columns
    for other_col in df.columns:
        if other_col == col: continue
        
        try:
            if pd.api.types.is_numeric_dtype(df[other_col]) and df[other_col].nunique() > 1:
                # Correlation for numeric columns
                corr = missing_indicator.corr(df[other_col])
                if pd.notnull(corr) and abs(corr) > 0.3:
                    correlations[other_col] = round(corr, 2)
            
            # (A full categorical correlation check requires more advanced stats like Chi-Squared,
            # but this structure shows the intent to analyze all column types)

        except Exception:
            continue # Ignore columns that cause errors

    return correlations

def get_statistical_profile(df: pd.DataFrame, column_name: str) -> dict:
    """Calculates a robust, essential statistical profile for a column."""
    detected_type = detect_data_type(df[column_name])
    profile = {
        "column": column_name,
        "missing_pct": round(df[column_name].isnull().mean() * 100, 1),
        "data_type": detected_type, # 👈 USE THE DETECTED TYPE
        "unique_values": df[column_name].nunique()
    }

    if detected_type == "numeric":
            clean_data = df[column_name].dropna()
            if not clean_data.empty:
                profile["mean"] = round(clean_data.mean(), 2)
                profile["median"] = round(clean_data.median(), 2)

    profile["mnar_indicators"] = get_mnar_indicators(df, column_name)
    profile.update(get_temporal_profile(df, column_name))

    return profile


# Helper function of standardization
def perform_standardization(df: pd.DataFrame, column_name: str, method: str, file_path: str) -> dict:
    """
    Performs standardization, adds the new column, overwrites the file,
    and returns a single, efficient audit report for the entire job.
    """
    new_col_name = f"{column_name}_{method}_scaled"

    # Idempotency Check: If the column already exists, do nothing.
    if new_col_name in df.columns:
        return {
            "status": "SKIPPED",
            "message": f"Column '{new_col_name}' already exists."
        }

    # Input Validation
    if not pd.api.types.is_numeric_dtype(df[column_name]):
        raise ValueError(f"Column '{column_name}' is not numeric.")
    if df[column_name].isnull().any():
        raise ValueError(f"Column '{column_name}' contains missing values. Impute first.")

    # Perform Scaling
    scaler = StandardScaler() if method == 'standard' else MinMaxScaler()
    df[new_col_name] = scaler.fit_transform(df[[column_name]].values.astype(np.float32))

    # Overwrite the original CSV file with the updated data
    df.to_csv(file_path, index=False)

    # Generate Audit Report with Robust Statistics
    q1 = float(df[column_name].quantile(0.25))
    q3 = float(df[column_name].quantile(0.75))
    
    audit_report = {
        "new_column_added": new_col_name,
        "message": f"Successfully created new column: '{new_col_name}'.",
        "method": method,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "row_count_affected": len(df),
        "input_stats_robust": {
            "median": float(df[column_name].median()),
            "interquartile_range": q3 - q1,
        }
    }
    
    return audit_report

def perform_delete_column(df: pd.DataFrame, column_name: str, file_path: str):
    """
    Deletes a column from the DataFrame and overwrites the CSV file.
    """
    if column_name not in df.columns:
        raise ValueError(f"Column '{column_name}' not found.")
    
    # Drop the column
    df.drop(columns=[column_name], inplace=True)
    
    # Overwrite the original file
    df.to_csv(file_path, index=False)
    
    return {
        "message": f"Successfully deleted column '{column_name}' and updated the dataset."
    }

# main task router
@celery_app.task
def route_task(dataset_name: str, column_name: str, task_type: str, task_params: dict = None):
    """
    The main task router. It receives a job and calls the
    appropriate function based on the task_type.
    """
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

