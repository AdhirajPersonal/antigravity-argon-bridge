# Argon Model Consultation Rules

- **Quota Efficiency**: Never invoke `consult_argon` repeatedly for trivial iterations. Condense queries so that a single prompt provides all required context and receives a comprehensive reasoning response.
- **Synthesized Output**: When presenting Argon's findings to the user, always synthesize and contextualize the recommendations rather than dumping raw markdown without analysis.
- **Thinking Process Visibility**: If Argon returns a detailed reasoning breakdown (`thinkingProcess`), preserve key analytical insights for the user.
- **Account Health**: If a web query indicates that usage limits are reached (e.g. 100% used or rate-limit warnings), notify the user and suggest either waiting for the reset time or switching to a secondary Google Pro account using `switch_argon_account`.
