#!/bin/bash
set -euo pipefail
umask 077
launcher_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
release_file="$launcher_dir/releases.json"
base="${MEAI_DATA_DIR:-$HOME/Library/Application Support/Me Ensina AI}"
case "$base" in /*) ;; *) echo 'MEAI_DATA_DIR precisa ser um caminho absoluto.' >&2; exit 1;; esac
no_open=''
case "${1:-}" in '') ;; --no-open) no_open='--no-open';; --validate-release) ;; *) echo 'Use open-editor.command [--no-open]' >&2; exit 1;; esac
[ "$#" -le 1 ] || exit 1

[ "$(/usr/bin/uname -s)" = Darwin ] || { echo 'Use open-editor.ps1 no Windows.' >&2; exit 1; }
case "$(/usr/bin/uname -m)" in arm64) platform='darwin-arm64';; x86_64) platform='darwin-x64';; *) echo 'Arquitetura macOS não suportada.' >&2; exit 1;; esac
read_release() {
  version="$(/usr/bin/plutil -extract version raw -o - "$release_file")"
  release_url="$(/usr/bin/plutil -extract "platforms.$platform.url" raw -o - "$release_file")"
  release_sha="$(/usr/bin/plutil -extract "platforms.$platform.sha256" raw -o - "$release_file")"
  package_name="$(/usr/bin/plutil -extract "platforms.$platform.packageDirectory" raw -o - "$release_file")"
  [[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$ ]] || return 1
  [[ "$release_sha" =~ ^[a-f0-9]{64}$ ]] || return 1
  [[ "$package_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$ ]] || return 1
  [[ "$release_url" =~ ^https://github\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\.zip$ ]] || return 1
}
if [ "${1:-}" = '--validate-release' ]; then read_release || { echo 'releases.json inválido ou SHA ainda não preenchido.' >&2; exit 1; }; echo 'releases.json válido'; exit 0; fi


# Reuse an already running editor without replacing files, restarting or navigating it.
health="$(/usr/bin/curl --silent --fail --max-time 2 http://127.0.0.1:5201/api/health 2>/dev/null || true)"
app="$(printf '%s' "$health" | /usr/bin/plutil -extract app raw -o - - 2>/dev/null || true)"
if [ "$app" = 'me-ensina-ai-editor' ]; then echo 'Editor já disponível: http://127.0.0.1:5201/'; exit 0; fi

package="${MEAI_PACKAGE_DIR:-$base/current}"
case "$package" in /*) ;; *) echo 'MEAI_PACKAGE_DIR precisa ser absoluto.' >&2; exit 1;; esac
if [ ! -x "$package/bin/node" ] || [ ! -f "$package/runtime/server.mjs" ] || { [ ! -f "$package/editor/dist/index.html" ] && [ ! -f "$package/setup-editor.mjs" ]; }; then
  read_release || { echo 'releases.json inválido ou SHA ainda não preenchido.' >&2; exit 1; }
  /bin/mkdir -p "$base/releases"
  target="$base/releases/$version-$platform-${release_sha:0:16}"
  package="$target/$package_name"
  if [ ! -x "$package/bin/node" ] || [ ! -f "$target/verified-sha256" ] || [ "$(/bin/cat "$target/verified-sha256")" != "$release_sha" ]; then
    [ ! -e "$target" ] || { echo 'Instalação incompleta existente preservada; revise a pasta de releases.' >&2; exit 1; }
    lock="$target.lock"
    /bin/mkdir "$lock" 2>/dev/null || { echo 'Outra preparação desta release está em andamento. Tente novamente após terminar.' >&2; exit 1; }
    stage=''
    trap '[ -z "$stage" ] || /bin/rm -rf "$stage"; /bin/rmdir "$lock"' EXIT
    [ ! -e "$target" ] || { echo 'Release criada por outra execução; tente abrir novamente.' >&2; exit 1; }
    stage="$(/usr/bin/mktemp -d "$base/releases/.download-XXXXXX")"
    echo "Baixando release $version. Não será instalado outro Codex."
    /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --retry 2 --connect-timeout 20 --output "$stage/release.zip" "$release_url"
    actual_sha="$(/usr/bin/shasum -a 256 "$stage/release.zip" | /usr/bin/awk '{print $1}')"
    [ "$actual_sha" = "$release_sha" ] || { echo 'SHA-256 divergente. Pacote não executado.' >&2; exit 1; }
    /usr/bin/zipinfo -1 "$stage/release.zip" > "$stage/entries.txt"
    while IFS= read -r entry; do
      case "$entry" in /*|../*|*/../*|*/..|..|*\\*) echo 'Caminho inseguro no ZIP.' >&2; exit 1;; esac
    done < "$stage/entries.txt"
    /usr/bin/zipinfo -l "$stage/release.zip" | /usr/bin/awk '/^l/ {bad=1} END {exit bad}' || { echo 'Symlink inesperado no ZIP.' >&2; exit 1; }
    /bin/mkdir "$stage/content"
    /usr/bin/ditto -x -k "$stage/release.zip" "$stage/content"
    [ -x "$stage/content/$package_name/bin/node" ] && [ -f "$stage/content/$package_name/runtime/server.mjs" ] && { [ -f "$stage/content/$package_name/editor/dist/index.html" ] || [ -f "$stage/content/$package_name/setup-editor.mjs" ]; } || { echo 'Release sem runtime completo.' >&2; exit 1; }
    printf '%s\n' "$release_sha" > "$stage/content/verified-sha256"
    /bin/mv "$stage/content" "$target"
    /bin/rm -rf "$stage"
    /bin/rmdir "$lock"
    trap - EXIT
  fi
fi
# install.mjs/manage.mjs are intentionally not invoked: neither opening the
# editor nor installing its files requires a Codex CLI or plugin CLI command.
exec "$package/bin/node" "$launcher_dir/start-editor.mjs" --package-dir "$package" ${no_open:+"$no_open"}
