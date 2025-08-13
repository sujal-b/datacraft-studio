# backend/data_type_detector.py
import pandas as pd
import re

def detect_data_type(series: pd.Series) -> str:
    """
    Professional data type detection using a series of checks.
    """
    # Drop missing values for analysis
    clean_series = series.dropna()
    if clean_series.empty:
        return "empty"

    # Check for numeric (the most reliable check)
    if pd.api.types.is_numeric_dtype(clean_series):
            # 👇 THE IMPROVEMENT IS HERE
            # Check if all numbers in the clean series are whole numbers
            if (clean_series.astype(float) == clean_series.astype(int)).all():
                # If it has high cardinality, it's likely an identifier
                if clean_series.nunique() > 50:
                    return "identifier"
                return "integer"
            else:
                return "float"

    # Check for datetime objects with a high confidence threshold
    try:
        # Attempt to convert to datetime, count successes
        datetime_matches = pd.to_datetime(clean_series, errors='coerce').notna().sum()
        if (datetime_matches / len(clean_series)) > 0.8:
            return "date"
    except Exception:
        pass

    # Differentiate between categorical (low unique ratio) and text (high unique ratio)
    unique_ratio = clean_series.nunique() / len(clean_series)
    if unique_ratio < 0.05 and clean_series.nunique() > 1:
        return "categorical"
    
    return "text"