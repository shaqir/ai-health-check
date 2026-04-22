"""
Operational one-shot scripts that live outside the main app package.

These are small CLI tools invoked by an operator (not the running
FastAPI process). Each module should expose a testable function
returning a result dict, plus a thin `main()` + `if __name__ ==
"__main__":` entry point for the CLI.
"""
