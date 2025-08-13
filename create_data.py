# create_data.py
import pandas as pd
import numpy as np

# --- Create Sales Dataset ---
sales_data = {
    'date': pd.to_datetime(pd.date_range(start='2024-01-01', periods=100, freq='D')),
    'customer_id': [f'CUST{i:03}' for i in range(100)],
    'product_name': np.random.choice(['Widget A', 'Widget B', 'Gadget Pro', 'Thingamajig'], 100),
    'quantity': np.random.randint(1, 25, size=100),
    'unit_price': np.random.choice([29.99, 45.50, 199.99, 9.99], 100),
    'region': np.random.choice(['North', 'South', 'East', 'West'], 100),
    'sales_rep': np.random.choice(['John Smith', 'Jane Doe', 'Mike Johnson', 'Emily White'], 100)
}
sales_df = pd.DataFrame(sales_data)
sales_df['total_amount'] = sales_df['quantity'] * sales_df['unit_price']

# Save to the public folder so the app can fetch it
sales_df.to_csv('./public/sales_data_2024.csv', index=False)


# --- Create Inventory Dataset ---
inventory_data = {
    'product_id': [f'PROD{i:04}' for i in range(50)],
    'product_name': np.random.choice(['Widget A', 'Widget B', 'Gadget Pro', 'Thingamajig', 'Doohickey'], 50),
    'stock_level': np.random.randint(0, 500, size=50),
    'warehouse_location': np.random.choice(['WH-A', 'WH-B', 'WH-C'], 50),
    'last_restock_date': pd.to_datetime(pd.date_range(start='2024-05-01', periods=50, freq='D')),
}
inventory_df = pd.DataFrame(inventory_data)

# Save to the public folder
inventory_df.to_csv('./public/inventory_data_2024.csv', index=False)

print("✅ Sample datasets created successfully in the 'public' folder.")