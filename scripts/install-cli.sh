#!/bin/sh
# Builds the looks CLI and puts a `looks` launcher on your PATH.
# The launcher pins the Node binary that ran this script, so `looks` keeps
# working when you switch Node versions with nvm.
#
#   sh scripts/install-cli.sh            # first writable of /usr/local/bin, /opt/homebrew/bin, ~/.local/bin
#   sh scripts/install-cli.sh ~/bin      # or a folder of your choice
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
BIN_DIR="${1:-}"

if [ -z "$BIN_DIR" ]; then
  for d in /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin"; do
    if [ -d "$d" ] && [ -w "$d" ]; then BIN_DIR="$d"; break; fi
  done
fi
if [ -z "$BIN_DIR" ]; then
  echo "No writable bin folder found. Pass one, e.g.: sh scripts/install-cli.sh ~/bin" >&2
  exit 1
fi

(cd "$ROOT/packages/cli" && "$NODE" build.mjs >/dev/null)

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/looks" <<EOF
#!/bin/sh
exec "$NODE" "$ROOT/packages/cli/dist/looks.js" "\$@"
EOF
chmod +x "$BIN_DIR/looks"

echo "Installed $BIN_DIR/looks (Node $("$NODE" --version))"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not on your PATH yet." ;;
esac
