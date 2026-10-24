ERROR_EXPLANATIONS = {
    "KeyError": {
        "code": "PY-KEYERROR",
        "description": (
            "The bot attempted to access a dictionary key that does not exist."
        ),
    },

    "IndexError": {
        "code": "PY-INDEXERROR",
        "description": (
            "The bot attempted to access an item outside the available "
            "range of a list or sequence."
        ),
    },

    "AttributeError": {
        "code": "PY-ATTRIBUTEERROR",
        "description": (
            "The bot attempted to use an attribute or method that does "
            "not exist on an object."
        ),
    },

    "TypeError": {
        "code": "PY-TYPEERROR",
        "description": (
            "The bot attempted to perform an operation using an "
            "incompatible data type."
        ),
    },

    "ValueError": {
        "code": "PY-VALUEERROR",
        "description": (
            "The bot received a value of the correct type, but the "
            "value itself was invalid."
        ),
    },

    "NameError": {
        "code": "PY-NAMEERROR",
        "description": (
            "The bot attempted to use a variable, function, or name "
            "that has not been defined."
        ),
    },

    "FileNotFoundError": {
        "code": "PY-FILENOTFOUND",
        "description": (
            "The bot attempted to access a file or path that does not exist."
        ),
    },

    "PermissionError": {
        "code": "PY-PERMISSION",
        "description": (
            "The bot attempted to access a file or resource without "
            "sufficient permissions."
        ),
    },

    "JSONDecodeError": {
        "code": "PY-JSONDECODE",
        "description": (
            "The bot attempted to read JSON data that is malformed or invalid."
        ),
    },

    "TimeoutError": {
        "code": "PY-TIMEOUT",
        "description": (
            "An operation took too long to complete."
        ),
    },

    "ConnectionError": {
        "code": "PY-CONNECTION",
        "description": (
            "The bot encountered a problem connecting to another "
            "service or resource."
        ),
    },

    "OSError": {
        "code": "PY-OSERROR",
        "description": (
            "The bot encountered an operating-system-level error while "
            "attempting to complete an operation."
        ),
    },

    "RuntimeError": {
        "code": "PY-RUNTIME",
        "description": (
            "The bot encountered a runtime problem while executing an "
            "operation that could not be completed normally."
        ),
    },

    "ImportError": {
        "code": "PY-IMPORT",
        "description": (
            "The bot failed to import a required module, package, or "
            "component."
        ),
    },

    "ModuleNotFoundError": {
        "code": "PY-MODULE",
        "description": (
            "The bot attempted to import a module that could not be found."
        ),
    },

    "UnboundLocalError": {
        "code": "PY-UNBOUNDLOCAL",
        "description": (
            "The bot attempted to use a local variable before it had "
            "been assigned a value."
        ),
    },

    "ZeroDivisionError": {
        "code": "PY-ZERODIVISION",
        "description": (
            "The bot attempted to divide a value by zero."
        ),
    },

    "OverflowError": {
        "code": "PY-OVERFLOW",
        "description": (
            "A numerical operation produced a result too large for "
            "the operation to handle."
        ),
    },

    "RecursionError": {
        "code": "PY-RECURSION",
        "description": (
            "The bot exceeded Python's maximum recursion depth."
        ),
    },

    "AssertionError": {
        "code": "PY-ASSERTION",
        "description": (
            "An internal condition that the bot expected to be true "
            "was not satisfied."
        ),
    },

    "NotImplementedError": {
        "code": "PY-NOTIMPLEMENTED",
        "description": (
            "The bot attempted to use functionality that has not been "
            "implemented yet."
        ),
    },

    "HTTPException": {
        "code": "DC-HTTPEXCEPTION",
        "description": (
            "Discord returned an error while processing the bot's request."
        ),
    },

    "Forbidden": {
        "code": "DC-FORBIDDEN",
        "description": (
            "Discord refused the requested action because the bot does "
            "not have sufficient permissions."
        ),
    },

    "NotFound": {
        "code": "DC-NOTFOUND",
        "description": (
            "The requested Discord resource could not be found."
        ),
    },
}


DEFAULT_EXPLANATION = {
    "code": "PY-UNKNOWN",
    "description": (
        "The bot encountered an unexpected internal error. "
        "The stored error details may be required to determine "
        "the exact cause."
    ),
}


def explain_error(
    error_type: str
) -> dict:
    return ERROR_EXPLANATIONS.get(
        error_type,
        DEFAULT_EXPLANATION
    )