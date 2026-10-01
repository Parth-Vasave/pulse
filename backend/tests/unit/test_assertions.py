from app.services.assertions import ResponseView, evaluate_all, registered_types


def resp(body, status=200):
    return ResponseView(status, {}, body)


def test_body_contains():
    assert evaluate_all([{"type": "body_contains", "value": '"database": "connected"'}],
                        resp('{"database": "connected"}')).passed
    assert not evaluate_all([{"type": "body_contains", "value": "x"}], resp("abc")).passed


def test_json_field_eq():
    a = [{"type": "json_field", "path": "status", "operator": "eq", "value": "healthy"}]
    assert evaluate_all(a, resp('{"status": "healthy"}')).passed
    r = evaluate_all(a, resp('{"status": "degraded"}'))
    assert not r.passed and "degraded" in r.message


def test_json_nested_and_list_paths():
    a = [{"type": "json_field", "path": "checks.0.ok", "operator": "eq", "value": True}]
    assert evaluate_all(a, resp('{"checks": [{"ok": true}]}')).passed


def test_json_missing_field_and_invalid_json():
    a = [{"type": "json_field", "path": "a.b", "operator": "exists"}]
    assert not evaluate_all(a, resp('{"a": {}}')).passed
    assert "not valid JSON" in evaluate_all(a, resp("<html>")).message


def test_unknown_type_fails_closed():
    assert not evaluate_all([{"type": "nope"}], resp("")).passed


def test_empty_assertions_pass_and_first_failure_wins():
    assert evaluate_all([], resp("")).passed
    r = evaluate_all([{"type": "body_contains", "value": "a"}, {"type": "body_contains", "value": "zzz"}], resp("a"))
    assert "zzz" in r.message


def test_registry_extensible():
    assert {"body_contains", "body_not_contains", "json_field"} <= registered_types()
