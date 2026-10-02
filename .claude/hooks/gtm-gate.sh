#!/bin/sh
# GTM Harness approval gate (Claude Code PreToolUse hook on the Bash tool).
# Turns the SKILL.md policy into an enforced rule:
#   allow  → read-only gtm commands, any --dry-run, pilots (`gtm run … --limit N`, N ≤ 3)
#   ask    → paid full runs (gtm run without --dry-run and without a pilot limit),
#            --refresh (re-buys cached calls), sync-hubspot without dry_run,
#            `supabase db push`, `gtm signals pull` without --dry-run
#   demo scripts → page reads and rehearsals allowed; live runs and HubSpot writes ask
#   (silent) → anything else falls through to Claude Code's normal prompt
# Only plain single-line `gtm …` invocations are classified. Anything chained, redirected,
# substituted, escaped or multi-line falls through to Claude Code's normal prompt (fail open).
set -fu
command -v jq >/dev/null 2>&1 || exit 0
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r 'if .tool_name == "Bash" then .tool_input.command // empty else empty end' 2>/dev/null)"
[ -n "$cmd" ] || exit 0
# Tolerate the harmless `2>/dev/null` / `>/dev/null` / `2>&1` suffixes, then require a plain command:
cmd="$(printf '%s' "$cmd" | sed -E 's#([0-9]*|&)>>?[[:space:]]*/dev/null([[:space:]]|$)#\2#g; s/[0-9]*>&[0-9]+//g')"
# no shell metacharacters (chaining, pipes, redirection, substitution, escapes) …
[ -z "$(printf '%s' "$cmd" | tr -d -c ';&<>`$\\|')" ] || exit 0
# … a single line, of reasonable length
[ "$(printf '%s' "$cmd" | wc -l | tr -d ' ')" = "0" ] || exit 0
[ "${#cmd}" -le 4000 ] || exit 0

emit() { printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"; exit 0; }
has() { printf '%s' "$cmd" | grep -Eq -- "$1"; }

# supabase schema changes always ask
if has '^[[:space:]]*supabase[[:space:]]+db[[:space:]]+push'; then emit ask "gtm-gate: schema push to the live database"; fi

# The demo scripts: a page read is free, a rehearsal is mocked, a live run bills FullEnrich, --write writes HubSpot.
script="$(printf '%s' "$cmd" | sed -nE 's#^[[:space:]]*node[[:space:]]+([^[:space:]]*/)?scripts/([a-z-]+)\.mjs([[:space:]].*)?$#\2#p')"
case "$script" in
  integrations-signal|score-universe) emit allow "gtm-gate: public page read, no provider spend" ;;
  push-csv-to-hubspot)
    if has '(^|[[:space:]])--write([[:space:]]|$)'; then emit ask "gtm-gate: writes companies and contacts to HubSpot"; fi
    emit allow "gtm-gate: HubSpot preview, nothing written" ;;
  demo-one-account)
    if has '(^|[[:space:]])--rehearse([[:space:]]|$)'; then emit allow "gtm-gate: rehearsal, mock providers, no spend"; fi
    if has '(^|[[:space:]])--write([[:space:]]|$)'; then emit ask "gtm-gate: live run, FullEnrich credits (see --max-credits) and a HubSpot write"; fi
    emit ask "gtm-gate: live run, FullEnrich credits (see --max-credits), HubSpot preview only" ;;
esac

# normalise `node bin/gtm.mjs …` / `node …/gtm.mjs …` to `gtm …`
norm="$(printf '%s' "$cmd" | sed -E 's#^[[:space:]]*node[[:space:]]+[^[:space:]]*gtm\.mjs[[:space:]]+#gtm #')"
case "$norm" in gtm\ *) ;; *) exit 0 ;; esac
sub="$(printf '%s' "$norm" | awk '{print $2}')"

case "$sub" in
  providers|plays|csv|receipt|cache|audit) emit allow "gtm-gate: read-only gtm command" ;;
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
