import warnings
warnings.filterwarnings("ignore", category=FutureWarning)
import os
import sys
import google.generativeai as genai

# 1. Setup - Make sure this key matches your Google AI Studio exactly
genai.configure(api_key="AIzaSyBJFXJoe8OdSsiSD-odRvAQksZikzTukfQ")

# Using the 1.5 Flash model - it's fast and reliable for this
model = genai.GenerativeModel('gemini-1.5-flash')

IGNORE = {'.git', 'node_modules', '__pycache__', 'dist', 'AI_FEEDBACK.md', 'sentinel.py', '.env'}

def run_analysis():
    codebase = ""
    for root, dirs, files in os.walk("."):
        dirs[:] = [d for d in dirs if d not in IGNORE]
        for file in files:
            try:
                file_path = os.path.join(root, file)
                with open(file_path, 'r', encoding='utf-8') as f:
                    codebase += f"\n\n--- FILE: {file_path} ---\n{f.read()}"
            except: continue

    prompt = (
        "ACT AS: Senior Architect. REVIEW: The attached codebase vs PLAN.md.\n\n"
        "OUTPUT REQUIREMENTS:\n"
        "1. [PASS]: If the code is bug-free and matches the plan.\n"
        "2. [BLOCK]: If there is a CRITICAL bug or it deviates from the plan.\n"
        "3. Provide a 'Claude-Ready' technical plan for the next feature.\n"
    )

    try:
        response = model.generate_content([prompt, codebase])
        feedback = response.text
        
        with open("AI_FEEDBACK.md", "w", encoding='utf-8') as f:
            f.write(f"# Sentinel Commit Audit\n\n{feedback}")

        if "[BLOCK]" in feedback.upper():
            print("--- SENTINEL: Issues found. Commit REJECTED. Check AI_FEEDBACK.md ---")
            sys.exit(1) 
        
        print("--- SENTINEL: Analysis passed. Commit ACCEPTED. ---")
        sys.exit(0)

    except Exception as e:
        # Removed the emoji here to prevent Windows crashing
        print(f"SENTINEL Error: {str(e)}")
        sys.exit(0)

if __name__ == "__main__":
    run_analysis()