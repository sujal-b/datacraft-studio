# backend/ai_service.py

import json
import os
import requests
import re 

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY","")
if not OPENROUTER_API_KEY:
    raise ValueError("CRITICAL ERROR: OPENROUTER_API_KEY environment variable is not set.")


def get_ai_interpretation(profile: dict) -> dict:
    """
    Sends a detailed statistical profile to an LLM for expert interpretation.
    """
    # A simplified but still powerful system prompt that is less prone to formatting errors.
    system_prompt = """
    You are a principal data scientist with 20+ years experience. Your task is to analyze a statistical profile of a column and provide a professional recommendation that reflects how human experts think — not rigid rule-following.

    ## HOW REAL DATA SCIENTISTS THINK (NOT RULE ENGINES)
    When handling missing data, experienced professionals:
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
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3000", # Recommended by OpenRouter
                "X-Title": "DataCraft Studio"
            },
            data=json.dumps({
                # Using a reliable and fast model
                "model": "openai/gpt-oss-20b:free",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ]
            }),
            timeout=45
        )
        response.raise_for_status()
        
        response_data = response.json()
        ai_content_string = response_data['choices'][0]['message']['content']
        

        # ROBUST PARSING: Find and extract the JSON object from the response string.
        # This is much more reliable than a simple json.loads().
        json_match = re.search(r'\{.*\}', ai_content_string, re.DOTALL)
        if not json_match:
            raise json.JSONDecodeError("No valid JSON object found in the AI response.", ai_content_string, 0)
            
        return json.loads(json_match.group(0))

    except requests.exceptions.HTTPError as http_err:
        # This will now give you a very clear error if your API key is wrong.
        error_message = f"HTTP error occurred: {http_err} - Response: {http_err.response.text}"
        print(f"ERROR: {error_message}")
        return {
            "recommendation": "API Connection Error",
            "reasoning_summary": "Could not get a valid response from the AI service. This is often caused by an invalid API key, billing issues, or model unavailability.",
            "assumptions": [],
            "warning": str(error_message)
        }

    except requests.exceptions.RequestException as e:
        print(f"Error calling AI service: {e}")
        return {
            "recommendation": "AI Service Error",
            "reasoning_summary": "Could not connect to the AI model. Check the network and API key.",
            "assumptions": [],
            "warning": str(e)
        }
    except Exception as e:
        print(f"Error parsing AI response: {e}")
        return {
            "recommendation": "Invalid AI Response",
            "reasoning_summary": "The AI model returned a malformed response that could not be parsed.",
            "assumptions": [],
            "warning": str(e)
        }
