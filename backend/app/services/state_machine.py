"""Pure incident state machine (no I/O), so every transition is unit-testable.

    UNKNOWN/UP --(consecutive failures >= failure_threshold)--> DOWN  [open incident]
    DOWN --(consecutive successes >= recovery_threshold)--> UP        [resolve incident]

While DOWN, a failure resets the success streak (recovery must be *consecutive*)
and keeps counting failures. While UP, a success resets the failure streak.
"""

from dataclasses import dataclass
from enum import StrEnum


class Status(StrEnum):
    UNKNOWN = "unknown"
    UP = "up"
    DOWN = "down"


class Action(StrEnum):
    NONE = "none"
    OPEN_INCIDENT = "open_incident"
    RESOLVE_INCIDENT = "resolve_incident"


@dataclass(frozen=True)
class HealthState:
    status: Status = Status.UNKNOWN
    consecutive_failures: int = 0
    consecutive_successes: int = 0


@dataclass(frozen=True)
class Transition:
    state: HealthState
    action: Action = Action.NONE


def next_state(state: HealthState, success: bool, failure_threshold: int, recovery_threshold: int) -> Transition:
    if success:
        successes = state.consecutive_successes + 1
        if state.status is Status.DOWN:
            if successes >= recovery_threshold:
                return Transition(HealthState(Status.UP, 0, successes), Action.RESOLVE_INCIDENT)
            return Transition(HealthState(Status.DOWN, state.consecutive_failures, successes))
        return Transition(HealthState(Status.UP, 0, successes))

    failures = state.consecutive_failures + 1
    if state.status is Status.DOWN:
        return Transition(HealthState(Status.DOWN, failures, 0))
    if failures >= failure_threshold:
        return Transition(HealthState(Status.DOWN, failures, 0), Action.OPEN_INCIDENT)
    return Transition(HealthState(state.status, failures, 0))
