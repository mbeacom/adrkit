#!/bin/sh
set -eu

ADRKIT_HOME="${ADRKIT_HOME:-/opt/adrkit}"

show_help() {
    cat <<'EOF'
usage: adrkit-container [selector] [args...]

selectors:
  cli | adr | adrkit              Run the adr CLI
  mcp | adrkit-mcp                Run the stdio MCP server
  ci | adrkit-ci                  Run the governing-decisions GitHub Action
  queue-action | adrkit-queue-action
                                  Run the managed ARB queue GitHub Action

Container help is reserved for no arguments, `-h`, `--help`,
`container-help`, and `--container-help`.
Every other first argument is passed to the adr CLI, including `help <command>`.
Run `adrkit-container cli --help` for CLI command help.
EOF
}

if [ "$#" -eq 0 ]; then
  show_help
  exit 0
fi

command="$1"

case "$command" in
  -h | --help | container-help | --container-help)
    show_help
    ;;
  cli | adr | adrkit)
    shift
    exec node "$ADRKIT_HOME/adr.js" "$@"
    ;;
  mcp | adrkit-mcp)
    shift
    exec node "$ADRKIT_HOME/adrkit-mcp.js" "$@"
    ;;
  ci | adrkit-ci)
    shift
    exec node "$ADRKIT_HOME/ci.js" "$@"
    ;;
  queue-action | adrkit-queue-action)
    shift
    exec node "$ADRKIT_HOME/queue-action.js" "$@"
    ;;
  *)
    exec node "$ADRKIT_HOME/adr.js" "$@"
    ;;
esac
