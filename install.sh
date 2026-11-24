#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/bin"
cat > "$HOME/bin/toolbox" <<WRAPPER
#!/usr/bin/env bash
exec node "$ROOT/src/toolbox.js" "\$@"
WRAPPER
chmod +x "$HOME/bin/toolbox"
# Keep radar as a compatibility alias for existing muscle memory.
cat > "$HOME/bin/radar" <<WRAPPER
#!/usr/bin/env bash
exec "$HOME/bin/toolbox" "\$@"
WRAPPER
chmod +x "$HOME/bin/radar"
if ! grep -q 'export PATH="$HOME/bin:$PATH"' "$HOME/.zshrc" 2>/dev/null; then
  echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.zshrc"
fi
printf '\nTOOLBOX installed to ~/bin/toolbox\nCompatibility alias: ~/bin/radar\nRun: source ~/.zshrc\nThen: toolbox help\n'
