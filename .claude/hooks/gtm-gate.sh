#!/bin/sh
# GTM Harness approval gate (Claude Code PreToolUse hook on the Bash tool).
# Turns the SKILL.md policy into an enforced rule:
#   allow  → read-only gtm commands, any --dry-run, pilots (`gtm run … --limit N`, N ≤ 3)
#   ask    → paid full runs (gtm run without --dry-run and without a pilot limit),
#            --refresh (re-buys cached calls), sync-hubspot without dry_run,
#            `supabase db push`, `gtm signals pull` without --dry-run
#   (silent) → anything else falls through to Claude Code's normal prompt
# Shell hardening adapted from Cargo's approve-cli.sh (MIT, © 2026 Cargo): reject chaining,
# redirection, substitution, backslashes and multi-line commands; fail open to the prompt.
set -fu
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r 'if .tool_name == "Bash" then .tool_input.command // empty else empty end' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
cmd="$(printf '%s' "$cmd" | sed -E 's#([0-9]*|&)>>?[[:space:]]*/dev/null([[:space:]]|$)#\2#g; s/[0-9]*>&[0-9]+//g')"
case "$cmd" in *';'*|*'&'*|*'<'*|*'>'*|*'`'*|*'$'*|*'\'*|*'|'*) exit 0 ;; esac
[ "$(printf '%s' "$cmd" | wc -l | tr -d ' ')" = "0" ] || exit 0
[ "${#cmd}" -le 4000 ] || exit 0

emit() { printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"; exit 0; }
has() { printf '%s' "$cmd" | grep -Eq -- "$1"; }

# supabase schema changes always ask
if has '^[[:space:]]*supabase[[:space:]]+db[[:space:]]+push'; then emit ask "gtm-gate: schema push to the live database"; fi

# normalise `node bin/gtm.mjs …` / `node …/gtm.mjs …` to `gtm …`
norm="$(printf '%s' "$cmd" | sed -E 's#^[[:space:]]*node[[:space:]]+[^[:space:]]*gtm\.mjs[[:space:]]+#gtm #')"
case "$norm" in gtm\ *) ;; *) exit 0 ;; esac
sub="$(printf '%s' "$norm" | awk '{print $2}')"

case "$sub" in
  providers|plays|csv|receipt|cache|prompts|audit) emit allow "gtm-gate: read-only gtm command" ;;
  db) if printf '%s' "$norm" | grep -Eq 'gtm[[:space:]]+db[[:space:]]+ping'; then emit allow "gtm-gate: db ping"; fi; exit 0 ;;
  run|signals)
    if has '(^|[[:space:]])--dry-run([[:space:]]|$)'; then emit allow "gtm-gate: dry-run, mock providers, no spend"; fi
    if has '(^|[[:space:]])--refresh([[:space:]]|$)'; then emit ask "gtm-gate: --refresh re-buys cached provider calls"; fi
    if has 'sync-hubspot' && ! has '"dry_run":[[:space:]]*true'; then emit ask "gtm-gate: writes to HubSpot"; fi
    if [ "$sub" = signals ]; then emit ask "gtm-gate: paid signal pull"; fi
    limit="$(printf '%s' "$norm" | sed -nE 's/.*--limit[[:space:]=]+([0-9]+).*/\1/p')"
    if [ -n "$limit" ] && [ "$limit" -le 3 ]; then emit allow "gtm-gate: pilot of $limit rows"; fi
    if has '(^|[[:space:]])--csv([[:space:]]|$)'; then emit ask "gtm-gate: full paid run over a CSV — pilot with --limit 3 first, or confirm"; fi
    emit ask "gtm-gate: paid run — confirm scope and cap (--max-credits)"
    ;;
esac
exit 0
