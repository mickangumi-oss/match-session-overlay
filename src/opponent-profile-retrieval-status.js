"use strict";

function errorCode(reason) {
  return reason instanceof Error ? reason.message : String(reason ?? "");
}

function opponentProfileFailureReason(error) {
  const code = errorCode(error);
  if (code === "PROFILE_REFERENCE_EMPTY") return "OPPONENT_PROFILE_DATA_EMPTY";
  if (code === "SERVICE_AUTH_REQUIRED") return "OPPONENT_PROFILE_AUTH_REQUIRED";
  if (code === "SERVICE_RATE_LIMITED") return "OPPONENT_PROFILE_RATE_LIMITED";
  if (code === "SERVICE_HTTP_404") return "OPPONENT_PROFILE_NOT_FOUND";
  if (code.startsWith("SERVICE_HTTP_")) return "OPPONENT_PROFILE_HTTP_ERROR";
  if (code === "HISTORY_LOCALE_CHANGED") return "OPPONENT_PROFILE_LOCALE_CHANGED";
  if (code === "PRIVATE_DATA_CLEARED") return "PRIVATE_DATA_CLEARED";
  if (code === "ACT_SCOPE_MISSING" || code === "HISTORY_ACT_METADATA_MISSING_OR_MISMATCH") {
    return "ACT_SCOPE_MISSING";
  }
  if (code === "HISTORY_SELECTED_REPLAY_SCOPE_MISSING") return "HISTORY_SELECTED_REPLAY_MISSING";
  if (code === "HISTORY_PAGE_SET_INCOMPLETE") return "HISTORY_SCOPE_INCOMPLETE";
  if (code === "HISTORY_REPLAY_DUPLICATE_CONFLICT") return "HISTORY_DUPLICATE_CONFLICT";
  return "OPPONENT_PROFILE_REQUEST_FAILED";
}

function playProfileFailureReason(result) {
  if (result?.status !== "rejected") return null;
  const code = errorCode(result.reason);
  if (code === "SERVICE_AUTH_REQUIRED") return "PLAY_PROFILE_AUTH_REQUIRED";
  if (code === "SERVICE_RATE_LIMITED") return "PLAY_PROFILE_RATE_LIMITED";
  if (code === "PRIVATE_DATA_CLEARED") return "PLAY_PROFILE_DATA_CLEARED";
  if (code === "SERVICE_HTTP_404") return "PLAY_PROFILE_NOT_FOUND";
  if (code.startsWith("SERVICE_HTTP_")) return "PLAY_PROFILE_HTTP_ERROR";
  return "PLAY_PROFILE_REQUEST_FAILED";
}

function playComparisonReason(comparison, selfResult, opponentResult) {
  const selfFailureReason = playProfileFailureReason(selfResult);
  const opponentFailureReason = playProfileFailureReason(opponentResult);
  const reason = selfFailureReason || opponentFailureReason || (
    comparison.status === "insufficient_sample"
      ? !comparison.samePeriod
        ? "PLAY_COMPARISON_PERIOD_MISMATCH"
        : !comparison.sameSample
          ? "PLAY_COMPARISON_SAMPLE_MISMATCH"
          : !comparison.sameScope
            ? "PLAY_COMPARISON_SCOPE_MISMATCH"
            : !comparison.withinWindow
              ? "PLAY_COMPARISON_WINDOW_EXCEEDED"
              : "PLAY_COMPARISON_INSUFFICIENT"
      : comparison.status === "unavailable"
        ? "PLAY_COMPARISON_DATA_EMPTY"
        : comparison.status === "error"
          ? "PLAY_COMPARISON_UNAVAILABLE"
          : comparison.status === "partial"
            ? "PLAY_COMPARISON_PARTIAL"
            : null
  );
  return {
    reason,
    failureReasons: {
      self: selfFailureReason,
      opponent: opponentFailureReason,
    },
  };
}

module.exports = {
  opponentProfileFailureReason,
  playComparisonReason,
  playProfileFailureReason,
};
