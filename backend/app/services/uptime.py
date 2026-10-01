def uptime_percentage(successful: int, total: int) -> float | None:
    """successful / total * 100, rounded to 3dp. None (not 0 or 100) when there is no data,
    so the UI can show "no data" instead of a misleading figure."""
    if total <= 0:
        return None
    return round(successful / total * 100, 3)
