#!/usr/bin/env python3
"""Structural drift detector for WhisperClick V3.

Catches issues that black/ruff cannot:
- File size violations (800 lines max)
- Function size violations (80 lines max)
- Architecture violations (backend importing pill modules)
- Forbidden patterns in source code

Exit code 0 = pass, 1 = violations found.
"""

import ast
import os
import re
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(PROJECT_ROOT, "src")
TOOLS_DIR = os.path.join(PROJECT_ROOT, "tools")

# --- Configuration ---

MAX_FILE_LINES = 800
MAX_FUNCTION_LINES = 80
WARN_FILE_LINES = 700  # emit warning when approaching limit

# Files exempted from file-size check (known tech debt)
FILE_SIZE_EXEMPTIONS = {
    os.path.join(SRC_DIR, "backend", "api.py"),  # 1274 lines, legacy monolith
    os.path.join(SRC_DIR, "main.py"),  # app entrypoint with DPI/hotkey/tray setup
}

# Functions exempted from function-size check (known tech debt)
FUNCTION_SIZE_EXEMPTIONS = {
    ("src/backend/api.py", "stop_recording"),  # ~120 lines, complex cleanup logic
    ("src/main.py", "main"),  # app entrypoint, inherently large
    ("src/main.py", "_install_nchittest_hook"),  # 118 lines, WndProc subclass with snap/maximize/drag
    ("src/main.py", "_on_webview_started"),  # 91 lines, HWND setup with style patching
    ("src/main.py", "_restore_and_save"),  # 86 lines, window state persistence on close
    ("src/pill_widget.py", "_build_dynamic_menu"),  # 81 lines, 1 over limit
}

# Directories exempted from file-size and function-size checks
# (test scripts and tool scripts have different constraints)
SIZE_EXEMPT_DIRS = {
    os.path.normpath(TOOLS_DIR),
}

# Forbidden pattern strings — matched literally in source files
# fmt: off
FORBIDDEN_PATTERNS = [
    (r"\bpythonw\.exe\b",              "Use python.exe, not pythonw.exe (crashes with Qt/PySide6)"),
    (r"\beasy_drag\s*=\s*True\b",      "easy_drag=True is broken on multi-monitor DPI setups"),
    (r"-webkit-app-region:\s*drag",     "-webkit-app-region: drag not supported by WebView2"),
    (r"\bimport\s+\*",                 "Wildcard imports break static analysis"),
]
# fmt: on

# Files exempted from forbidden-pattern checks (they define/document the patterns)
FORBIDDEN_PATTERN_EXEMPT_FILES = {
    os.path.normpath(os.path.join(TOOLS_DIR, "lint_audit.py")),
}

# Specific (file, line) exemptions for forbidden patterns (pre-existing tech debt)
# Use relative paths with forward slashes
FORBIDDEN_PATTERN_LINE_EXEMPTIONS = {
    ("src/backend/api.py", 1032),  # pythonw.exe reference in start-with-windows registry code
    ("src/backend/api.py", 1033),  # pythonw.exe variable usage on next line
}

# Bare except: pattern — allow lines with pragma or lint-suppression comments
BARE_EXCEPT_PATTERN = re.compile(r"^\s*except\s*:\s*(?!.*#\s*(pragma|noqa))")

# print() in src/ detection
PRINT_PATTERN = re.compile(r"^\s*print\s*\(")

# Specific (file, line) exemptions for print() in src/ (pre-existing, justified)
PRINT_EXEMPT_LINES = {
    ("src/main.py", 555),  # single-instance check, logger not yet initialized
    ("src/main.py", 772),  # fatal error fallback, logger may be unavailable
}


def collect_python_files(*dirs):
    """Yield .py file paths under the given directories."""
    for d in dirs:
        for root, _, files in os.walk(d):
            for f in files:
                if f.endswith(".py"):
                    yield os.path.join(root, f)


def relative(path):
    """Return path relative to project root for readable output."""
    return os.path.relpath(path, PROJECT_ROOT)


def _in_exempt_dir(path):
    """Check if path is under a size-exempt directory."""
    norm = os.path.normpath(path)
    return any(norm.startswith(d + os.sep) or norm == d for d in SIZE_EXEMPT_DIRS)


def check_file_size(path):
    """Check file line count against limits."""
    errors = []
    warnings = []
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    count = len(lines)
    rel = relative(path)
    abs_norm = os.path.normpath(path)

    if abs_norm in FILE_SIZE_EXEMPTIONS or _in_exempt_dir(path):
        return errors, warnings

    if count > MAX_FILE_LINES:
        errors.append(f"{rel}: {count} lines (max {MAX_FILE_LINES})")
    elif count > WARN_FILE_LINES:
        warnings.append(f"{rel}: {count} lines (approaching {MAX_FILE_LINES} limit)")

    return errors, warnings


def check_function_size(path):
    """Check function/method sizes using AST."""
    errors = []
    rel = relative(path)

    if _in_exempt_dir(path):
        return errors

    try:
        with open(path, encoding="utf-8") as f:
            source = f.read()
        tree = ast.parse(source, filename=path)
    except SyntaxError:
        return errors  # ruff/compileall will catch this

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            func_name = node.name
            end_line = getattr(node, "end_lineno", None)
            if end_line is None:
                continue
            func_lines = end_line - node.lineno + 1

            exemption_key = (rel.replace("\\", "/"), func_name)
            if exemption_key in FUNCTION_SIZE_EXEMPTIONS:
                continue

            if func_lines > MAX_FUNCTION_LINES:
                errors.append(f"{rel}:{node.lineno} {func_name}() is {func_lines} lines (max {MAX_FUNCTION_LINES})")

    return errors


def check_forbidden_patterns(path):
    """Check for forbidden patterns in source files."""
    errors = []
    rel = relative(path)
    rel_fwd = rel.replace("\\", "/")

    if os.path.normpath(path) in FORBIDDEN_PATTERN_EXEMPT_FILES:
        return errors

    with open(path, encoding="utf-8") as f:
        lines = f.readlines()

    for i, line in enumerate(lines, 1):
        if (rel_fwd, i) in FORBIDDEN_PATTERN_LINE_EXEMPTIONS:
            continue
        for pattern, message in FORBIDDEN_PATTERNS:
            if re.search(pattern, line):
                errors.append(f"{rel}:{i} {message}")

    return errors


def check_bare_except(path):
    """Check for bare except: without pragma or lint-suppression comments."""
    errors = []
    rel = relative(path)

    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            if BARE_EXCEPT_PATTERN.match(line):
                errors.append(f"{rel}:{i} Bare except: (use specific exception type)")

    return errors


def check_print_in_src(path):
    """Check for print() calls in src/ files."""
    errors = []
    if not os.path.normpath(path).startswith(os.path.normpath(SRC_DIR)):
        return errors

    rel = relative(path)
    rel_fwd = rel.replace("\\", "/")
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            if PRINT_PATTERN.match(line):
                if (rel_fwd, i) in PRINT_EXEMPT_LINES:
                    continue
                errors.append(f"{rel}:{i} print() in src/ — use _log instead")

    return errors


def check_architecture(path):
    """Check that backend modules don't import pill modules."""
    errors = []
    rel = relative(path)
    norm = os.path.normpath(path)
    backend_dir = os.path.normpath(os.path.join(SRC_DIR, "backend"))

    if not norm.startswith(backend_dir):
        return errors

    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            if re.search(r"\bimport\b.*\bpill_manager\b|\bimport\b.*\bpill_widget\b", line):
                errors.append(f"{rel}:{i} Backend must not import pill modules")
            if re.search(r"\bfrom\s+.*pill_manager\b|\bfrom\s+.*pill_widget\b", line):
                errors.append(f"{rel}:{i} Backend must not import pill modules")

    return errors


def main():
    scan_dirs = [SRC_DIR, TOOLS_DIR, os.path.join(PROJECT_ROOT, "tests")]
    all_files = list(collect_python_files(*scan_dirs))

    # Also include root-level .py files
    for f in os.listdir(PROJECT_ROOT):
        if f.endswith(".py"):
            all_files.append(os.path.join(PROJECT_ROOT, f))

    all_errors = []
    all_warnings = []

    for path in sorted(set(all_files)):
        errs, warns = check_file_size(path)
        all_errors.extend(errs)
        all_warnings.extend(warns)
        all_errors.extend(check_function_size(path))
        all_errors.extend(check_forbidden_patterns(path))
        all_errors.extend(check_bare_except(path))
        all_errors.extend(check_print_in_src(path))
        all_errors.extend(check_architecture(path))

    if all_warnings:
        print(f"\n--- Warnings ({len(all_warnings)}) ---")
        for w in all_warnings:
            print(f"  WARN: {w}")

    if all_errors:
        print(f"\n--- Errors ({len(all_errors)}) ---")
        for e in all_errors:
            print(f"  FAIL: {e}")
        print(f"\nlint_audit: {len(all_errors)} error(s), {len(all_warnings)} warning(s)")
        return 1

    print(f"\nlint_audit: PASS ({len(all_files)} files scanned, {len(all_warnings)} warning(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())
