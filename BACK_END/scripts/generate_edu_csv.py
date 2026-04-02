import psycopg2
import csv
import pandas as pd
from collections import defaultdict
from datetime import datetime

def main():
    conn = psycopg2.connect(
        dbname='haryalo-new',
        user='haryalo_user',
        password='StrongPassword123',
        host='72.60.192.17',
        port='5432'
    )
    cur = conn.cursor()
    
    cur.execute("SELECT id, department_name FROM api_gov_department WHERE department_name ILIKE '%education%' OR department_name ILIKE '%शिक्षा%';")
    dept_rows = cur.fetchall()
    
    if not dept_rows:
        print("No education department found.")
        return
        
    print("Found departments. Extracting data...")
        
    dept_ids = tuple(row[0] for row in dept_rows)
    
    # Query to get plantation records and their corresponding district names
    # Note: dict_code_id in p matches District_id in nd
    query = """
    SELECT 
        p.id, 
        d.department_name, 
        p."plantationArea", 
        p.number_of_plants,
        nd."District_name",
        p.created_at
    FROM api_blockplantation p
    JOIN api_gov_department d on p.goverment_departmet_id = d.id
    LEFT JOIN api_nursery_districtlist nd on p.dict_code_id::varchar = nd."District_id"::varchar
    WHERE p.goverment_departmet_id IN %s;
    """
    
    cur.execute(query, (dept_ids,))
    plantations = cur.fetchall()
    
    district_summary = defaultdict(lambda: {'area': 0.0, 'plants': 0})
    
    total_area = 0.0
    total_plants = 0
    
    raw_data = []
    
    current_time = datetime.now()

    for row in plantations:
        p_id, d_name, p_area_raw, p_plants_raw, dist_name, created_at = row
        
        # Calculate age in months
        age_in_months = 0
        if created_at and hasattr(created_at, 'year') and hasattr(created_at, 'month'):
            age_in_months = max(0, (current_time.year - created_at.year) * 12 + current_time.month - created_at.month)

        
        # Clean area
        try:
            area = float(p_area_raw) if p_area_raw is not None else 0.0
        except ValueError:
            area = 0.0
            
        # Clean plants
        plants = 0
        if p_plants_raw and str(p_plants_raw).strip():
            try:
                plants = int(float(p_plants_raw))
            except ValueError:
                plants = 0
            
        dist_name_str = dist_name if dist_name else "Unknown District"
        
        # Aggregate totals
        total_area += area
        total_plants += plants
        
        # Aggregate by district
        district_summary[dist_name_str]['area'] += area
        district_summary[dist_name_str]['plants'] += plants
        
        raw_data.append([p_id, d_name, dist_name_str, area, plants, age_in_months])
        
    # Prepare district summary rows for CSV and Excel
    dist_rows = []
    for dist, data in district_summary.items():
        plants_per_ha = data['plants'] / data['area'] if data['area'] > 0 else 0
        dist_rows.append([dist, data['area'], data['plants'], plants_per_ha])
    
    # Sort district rows alphabetically
    dist_rows.sort(key=lambda x: str(x[0]))
    
    # Write to CSV file (two sections)
    csv_file = 'education_department_summary_v3.csv'
    with open(csv_file, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        
        # Section 1: Raw Data
        writer.writerow(['--- RAW PLANTATION DATA ---'])
        writer.writerow(['Plantation ID', 'Department Name', 'District Name', 'Plantation Area', 'Number of Plants', 'Age in Months'])
        for row in raw_data:
            writer.writerow(row)
            
        writer.writerow([])
        writer.writerow(['TOTAL SUMMARY (RAW DATA)', '', '', total_area, total_plants, ''])
        
        # Section 2: District Summary
        writer.writerow([])
        writer.writerow([])
        writer.writerow(['--- DATA SUMMARY ---'])
        writer.writerow(['District Name', 'Total Plantation Area', 'Total Number of Plants', 'no of plants in one hectare'])
        for row in dist_rows:
            writer.writerow(row)
            
        writer.writerow([])
        total_plants_per_ha = total_plants / total_area if total_area > 0 else 0
        writer.writerow(['TOTAL SUMMARY (ALL DISTRICTS)', total_area, total_plants, total_plants_per_ha])
        
    # Also write to an Excel File with two proper sheets, as requested
    excel_file = 'education_department_summary_v3.xlsx'
    
    # Create DataFrames
    df_raw = pd.DataFrame(raw_data, columns=['Plantation ID', 'Department Name', 'District Name', 'Plantation Area', 'Number of Plants', 'Age in Months'])
    df_raw.loc[len(df_raw)] = ['TOTAL SUMMARY', '', '', total_area, total_plants, '']
    
    df_dist = pd.DataFrame(dist_rows, columns=['District Name', 'Total Plantation Area', 'Total Number of Plants', 'no of plants in one hectare'])
    total_plants_per_ha = total_plants / total_area if total_area > 0 else 0
    df_dist.loc[len(df_dist)] = ['TOTAL SUMMARY', total_area, total_plants, total_plants_per_ha]
    
    with pd.ExcelWriter(excel_file) as excel_writer:
        df_raw.to_excel(excel_writer, sheet_name='Raw Data', index=False)
        df_dist.to_excel(excel_writer, sheet_name='Data Summary', index=False)
        
    print(f"Files generated:")
    print(f"  - CSV: {csv_file} (Two sections in one file)")
    print(f"  - Excel: {excel_file} (Two sheets)")
    print(f"Total Rows Extracted: {len(plantations)}")
    print(f"Total Plantation Area: {total_area}")
    print(f"Total Number of Plants: {total_plants}")
    print(f"Total Districts Found: {len(district_summary)}")

if __name__ == "__main__":
    main()
