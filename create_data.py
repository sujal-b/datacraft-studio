import pandas as pd
import numpy as np
import random

# 1. Create a base dataset
rows = 1000
df = pd.DataFrame()

# TARGET: The thing we want to predict (0 or 1)
df['churned'] = np.random.choice([0, 1], size=rows)

# LEAKAGE TYPE 1: The "Perfect Predictor" (100% Correlation)
# e.g., A column that records the termination date (only exists if they churned)
df['termination_status'] = df['churned'].apply(lambda x: 'Terminated' if x == 1 else 'Active')

# LEAKAGE TYPE 2: The "Subtle Leaker" (98% Correlation)
# e.g., A billing flag that almost always matches the target
df['billing_issue_flag'] = df['churned'] * 0.98 + np.random.normal(0, 0.01, rows)

# LEAKAGE TYPE 3: High Cardinality ID (The "Overfitting" Trap)
# Unique IDs that the model might memorize
df['customer_transaction_id'] = [f"TXN_{i}_{random.randint(1000,9999)}" for i in range(rows)]

# Add some noise (normal columns)
df['age'] = np.random.randint(18, 80, rows)
df['balance'] = np.random.uniform(1000, 50000, rows)

# Save
df.to_csv('leakage_stress_test.csv', index=False)
print("Created 'leakage_stress_test.csv'. Upload this to DataCraft!")