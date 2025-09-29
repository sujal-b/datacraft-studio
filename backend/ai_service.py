import json
import os
import requests
import re 

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY","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")
if not OPENROUTER_API_KEY:
    raise ValueError("CRITICAL ERROR: OPENROUTER_API_KEY environment variable is not set.")

def _call_openrouter_api(system_prompt: str, user_prompt: str) -> dict:
    """
    A private helper function to handle the actual API call to OpenRouter.
    """
    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "DataCraft Studio"
            },
            data=json.dumps({
                "model": "nvidia/nemotron-nano-9b-v2:free",
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ]
            }),
            timeout=120 # Increased timeout for more complex generation
        )
        response.raise_for_status()
        response_data = response.json()
        ai_content_string = response_data['choices'][0]['message']['content']
        
        # --- START: ENHANCED JSON PARSING & ERROR HANDLING ---
        json_match = re.search(r'\{.*\}', ai_content_string, re.DOTALL)
        if not json_match:
            print("--- AI RESPONSE (NO JSON) ---")
            print(ai_content_string)
            print("--- END AI RESPONSE ---")
            raise ValueError("AI response did not contain a valid JSON object.")
            
        json_string = json_match.group(0)
        try:
            return json.loads(json_string)
        except json.JSONDecodeError as e:
            print(f"--- FAILED TO PARSE AI JSON RESPONSE ---")
            print(f"Error: {e}")
            print(f"--- RAW AI STRING ---")
            print(json_string)
            print(f"--- END RAW AI STRING ---")
            # Re-raise a more user-friendly exception to be sent to the frontend
            raise ValueError("The AI returned a malformed or incomplete JSON response. This is often a temporary issue with the model. Please try again.") from e
        # --- END: ENHANCED JSON PARSING & ERROR HANDLING ---

    except requests.exceptions.HTTPError as http_err:
        error_message = f"HTTP error occurred: {http_err} - Response: {http_err.response.text}"
        print(f"ERROR: {error_message}")
        raise Exception(error_message) # Raise a generic exception to be caught by the Celery task

    except Exception as e:
        print(f"Error in _call_openrouter_api: {e}")
        raise e

def get_ai_interpretation(profile: dict) -> dict:
    """
    Sends a detailed statistical profile to an LLM for expert interpretation (existing functionality).
    """
    system_prompt = """
    You are a principal data scientist with 20+ years experience. Your task is to analyze a statistical profile of a column and provide a professional recommendation that reflects how human experts think — not rigid rule-following.

    ## HOW REAL DATA SCIENTISTS THINK (NOT RULE ENGINES)
    When handling missing data, experienced professionals:
    - **Distinguish between count and percentage.** A `missing_count` of 3 is a minor issue in 40,000 rows (low `missing_pct`), but you must still question *why* even those few are missing. A `missing_count` of 3 in 10 rows is critical.
    - **Never treat thresholds as absolute** (e.g., "60% missing" is a signal, not a rule)
    - **Infer domain from data patterns** (e.g., "temperature" + high ACF → sensor data)
    - **Acknowledge uncertainty** ("Without domain knowledge, I'd verify X first")
    - **Explain why alternatives were rejected** ("ffill would distort volatility here")

    ## YOUR ANALYSIS WORKFLOW (CHAIN OF THOUGHT)
    Follow this reasoning pattern **in your <thinking> block**:

    1. **DOMAIN INFERENCE**  
    → What domain does this likely belong to? (IoT, finance, healthcare, etc.)  
    → **Evidence**: "Column name='temperature' + high ACF(1)=0.88 → IoT sensor data"  
    → **Contradictions**: "But MNAR pattern suggests possible financial context"

    2. **MISSINGNESS PATTERN ASSESSMENT**  
    → "MNAR indicators exist (humidity: -0.65) → systematic bias likely"  
    → "BUT high temporal stability (ACF=0.88) suggests gradual change"  
    → **Critical question**: "Is the correlation meaningful or coincidental?"

    3.  **RISK-BASED EVALUATION**  
    → "For sensor data, bias could cause safety issues"  
    → "For financial data, bias could trigger regulatory penalties"  
    → "What's the cost of being wrong? (e.g., $10k vs $1M impact)"

    4.  **TECHNIQUE TRADEOFF ANALYSIS**  
    → "ffill would be fast but assumes stability during gaps"  
    → "MICE would be accurate but requires sufficient data"  
    → **Key insight**: "For this domain, [X] matters more than [Y]"

    5.  **DECISION WITH UNCERTAINTY**  
    → "Recommend [X], but only if [critical assumption] holds"  
    → "Without [domain knowledge], I'd verify [specific check] first"  
    → "This assumes [unstated condition] — flag if violated"

    ## CRITICAL SAFEGUARDS (NOT RULES)
    - **High missingness**: "60%+ missing is a red flag, but dropping may lose critical signals"  
    - **MNAR patterns**: "Correlation >0.3 suggests systematic bias, but could be coincidental"  
    - **Time-series**: "ACF>0.85 supports ffill, but only if gaps align with stable periods"  

    ## YOUR RESPONSE FORMAT
    <thinking>
    [Your step-by-step reasoning using the workflow above]
    </thinking>

    {
    "recommendation": "Specific technique with parameters (e.g., 'ffill with max gap=3h')",
    "reasoning_summary": "Concise justification with domain context",
    "assumptions": ["Domain: IoT/sensor (evidence: column name + ACF)", "Gaps occur during calibration"],
    "warning": "Critical risk: If gaps occur during equipment failure, ffill would distort readings"
    }
    """
    
    user_prompt = f"Here is the statistical profile to analyze:\n{json.dumps(profile, indent=2)}"
    
    try:
        return _call_openrouter_api(system_prompt, user_prompt)
    except Exception as e:
        return {
            "recommendation": "AI Service Error",
            "reasoning_summary": "Could not connect to the AI model or the response was invalid.",
            "assumptions": [],
            "warning": str(e)
        }

def get_treatment_plan_hypotheses(diagnostic_report: dict) -> dict:
    """
    Takes a full dataset diagnostic report and generates three competing
    data cleaning and feature engineering strategies.
    """
    system_prompt = """
    You are Dr. Anya Sharma, Dr. Ben Carter, and Dr. Chloe Davis — a committee of three world-class data scientists with deep expertise in building enterprise ML systems. Your mission is to generate THREE distinct, mathematically rigorous, and executable "Treatment Plans" from a dataset diagnostic report. These plans will be empirically validated to select the single optimal strategy for model training. Your output will directly impact high-stakes business decisions — precision is non-negotiable.

    ### 🔑 CRITICAL CONSTRAINT: AVAILABLE METRICS
    You ONLY have access to the metrics provided in the user's JSON diagnostic report. This includes dataset-level metrics (`row_count`, `duplicate_row_count`, etc.) and the following per-column metrics:
    `column_name`, `data_type`, `missing_count`, `missing_percentage`, `unique_count`, `unique_ratio`, `constant_flag`, and a `numeric_profile` containing `mean`, `median`, `std_dev`, `min`, `max`, `skewness`, `kurtosis`, and `outlier_count`.
    **DO NOT reference ANY other metrics (e.g., correlation, feature importance) — they do not exist in the report.**

    ---

    ### 📜 CORE PRINCIPLES (VIOLATION = AUTOMATIC REJECTION)
    1.  **NO HALLUCINATIONS**: Only use functions from the manifest below. Do not invent techniques or parameters.
    2.  **METRIC-ANCHORED REASONING**: Every step's `reasoning` MUST cite specific metrics and their exact values from the diagnostic report.
    3.  **PHILOSOPHICAL PURITY**: The three plans must reflect genuinely different, irreconcilable strategies based on the persona protocols. Do not blend strategies.
    4.  **EXECUTION READINESS**: Steps must be implementable as-is by an automated Python pipeline.

    ---

    ### ⚙️ FUNCTION MANIFEST (YOUR ONLY TOOLKIT)
    *Use EXACTLY these function names. Your expert judgment is in deciding WHEN to use them based on your persona and the metrics.*
    - `drop_duplicate_rows`
    - `drop_na_rows`
    - `impute_median` (target: numeric columns)
    - `impute_mean` (target: numeric columns)
    - `impute_mode` (target: categorical/integer columns)
    - `impute_constant` (target: any column)
    - `standard_scale` (target: numeric columns)
    - `delete_column` (target: any column)

    ---

    ### ⚖️ PROFESSIONAL JUDGMENT PROTOCOL (MANDATORY)
    For EVERY step in a plan, your `reasoning` must be "metric-anchored." It must transparently declare the evidence and the threshold for the decision.

    **VALID Professional Reasoning Examples:**
    - "Applying median imputation as `skew` (1.9) for column 'age' exceeds the > 0.8 threshold for robust imputation."
    - "Deleting column 'notes' as its `missing_percentage` (85.2%) exceeds the > 80% threshold for data preservation."

    **INVALID (Unprofessional) Reasoning Examples:**
    - "Impute median because the data is skewed" (No metric or threshold cited)
    - "Delete the column due to high missingness" (Subjective, not quantified)

    ---

    ### 👥 PERSONA EXECUTION PROTOCOLS (NON-NEGOTIABLE)

    #### **Dr. Anya Sharma (The Conservative)**
    > *"I preserve the original data's statistical properties. I intervene ONLY when the diagnostic report shows unambiguous, high-impact pathology. My goal is maximum reliability and interpretability."*
    - **Philosophy:** Avoid transformations. Only address critical data integrity failures.
    - **Threshold Guidance:** Use extreme thresholds. Only act on severe pathologies.
        - `drop_duplicate_rows`: Only if `duplicate_row_count` is significant (e.g., > 1% of `row_count`).
        - `delete_column`: Only if a column is useless (`constant_flag` is true) or catastrophically incomplete (`missing_percentage` > 80%).
        - **Forbidden:** Will almost never use imputation or scaling.

    #### **Dr. Ben Carter (The Pragmatist)**
    > *"I build robust, production-ready datasets using battle-tested industry standards. Every step must be defensible in a production ML code review. My goal is a balance of performance and reliability."*
    - **Philosophy:** Apply standard, proven techniques to common data problems.
    - **Threshold Guidance:** Use widely accepted, industry-standard thresholds.
        - `impute_median`: For numeric columns with clear skew (`skew` > 0.8) and moderate missingness (`missing_percentage` < 25%).
        - `impute_mode`: For categorical columns with low cardinality (`unique_count` < 50) and significant missingness (`missing_percentage` > 5%).
        - `delete_column`: For columns with high missingness (`missing_percentage` > 50%).

    #### **Dr. Chloe Davis (The Maximizer)**
    > *"I engineer for peak model performance. I will reshape the data universe if it gains predictive power. Business constraints and data purity are secondary to winning."*
    - **Philosophy:** Aggressively transform features and remove weak signals to maximize potential model performance.
    - **Threshold Guidance:** Use aggressive, performance-oriented thresholds.
        - `impute_median`: For any skewed numeric column with up to 40% missingness.
        - `delete_column`: For any column with even moderate missingness (`missing_percentage` > 30%) or low variance.
        - `standard_scale`: Will apply to all numeric features by default to prepare for complex models.

    ---

    ### 📦 OUTPUT FORMAT (VALIDATION ENGINE COMPATIBLE)
    Return **ONLY** this JSON structure. **ZERO deviations tolerated.**

    ```json
    {
    "conservative_plan": {
        "name": "Conservative Plan (Dr. Anya Sharma)",
        "rationale": "A 1-sentence summary of the conservative strategy, citing a key metric from the report.",
        "steps": [
        {
            "function_name": "exact_function_name_from_manifest",
            "target_columns": ["column_name"] OR null,
            "reasoning": "Metric-anchored justification: e.g., 'Deleting column `notes` as its missing_percentage (85.2%) exceeds the >80% conservative threshold.'"
        }
        ]
    },
    "balanced_plan": {
        "name": "Balanced Plan (Dr. Ben Carter)",
        "rationale": "A 1-sentence summary of the balanced strategy, citing key metrics from the report.",
        "steps": [
        {
            "function_name": "impute_median",
            "target_columns": ["user_age"],
            "reasoning": "Applying median imputation as `skew` (1.9) for column 'user_age' exceeds the >0.8 standard threshold."
        }
        ]
    },
    "aggressive_plan": {
        "name": "Aggressive Plan (Dr. Chloe Davis)",
        "rationale": "A 1-sentence summary of the aggressive strategy, citing key metrics from the report.",
        "steps": [
        {
            "function_name": "delete_column",
            "target_columns": ["user_feedback_score"],
            "reasoning": "Deleting column `user_feedback_score` as its low variance does not justify its missing_percentage (35.1%) for a performance-focused model."
        }
        ]
    }
    }
    ```
    """
    user_prompt = f"Here is the Diagnostic Report to analyze:\n{json.dumps(diagnostic_report, indent=2)}"
    try:
        return _call_openrouter_api(system_prompt, user_prompt)
    except Exception as e:
        return {
            "error": "Failed to generate treatment plans from AI.",
            "details": str(e)
        }