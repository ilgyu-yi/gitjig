#!/bin/bash
# Source-checkout entry. Reuse the Node installer; host prerequisites are opt-in.
set -eu
unset BASH_ENV ENV
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
validate_args() {
    local seen_prefix=0 seen_runtime=0
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --help) printf '%s\n' 'Usage: bash install.sh [--prefix ABSOLUTE_PATH] [--setup-runtime]' 'Uses existing compatible Node/npm. In a terminal, missing prerequisites can be installed with Homebrew after review. Existing Docker/Linux installations remain supported.'; exit 0 ;;
            --prefix) [ "$seen_prefix" -eq 0 ] || { echo 'Duplicate --prefix' >&2; exit 1; }; seen_prefix=1; [ "$#" -ge 2 ] && [[ "$2" = /* ]] || { echo '--prefix needs an absolute path' >&2; exit 1; }; shift 2 ;;
            --setup-runtime) [ "$seen_runtime" -eq 0 ] || { echo 'Duplicate --setup-runtime' >&2; exit 1; }; seen_runtime=1; shift ;;
            *) echo "Unknown installation option: $1" >&2; exit 1 ;;
        esac
    done
}
validate_args "$@"
scratch=''
trap '[ -z "$scratch" ] || rm -rf -- "$scratch"' EXIT
trap 'echo "Installation interrupted. Host packages may remain; rerun this entry to continue." >&2; exit 130' INT
trap 'echo "Installation interrupted. Host packages may remain; rerun this entry to continue." >&2; exit 143' TERM
confirm() {
    [ -t 0 ] && [ -t 1 ] || return 1
    local answer default_yes=${2-y}
    while true; do
        if [ "$default_yes" = y ]; then printf '%s [Y/n]: ' "$1"; else printf '%s [y/N]: ' "$1"; fi
        IFS= read -r answer || return 1
        case "$answer" in '') [ "$default_yes" = y ]; return $? ;; y|Y|yes|YES|Yes) return 0 ;; n|N|no|NO|No) return 1 ;; *) echo 'Please answer yes or no.' ;; esac
    done
}
find_brew() {
    brew_bin=$(command -v brew || true)
    if [ -z "$brew_bin" ]; then
        for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew /home/linuxbrew/.linuxbrew/bin/brew; do
            if [ -x "$candidate" ]; then brew_bin=$candidate; break; fi
        done
    fi
    [ -n "$brew_bin" ] && [ -x "$brew_bin" ]
}
retry_prerequisite() {
    echo 'The prerequisite step stopped. Partial host effects may remain; no rollback is claimed.' >&2
    confirm 'Retry this prerequisite step with a fresh review, or finish?' n
}
ensure_brew() {
    if find_brew; then return; fi
    while true; do
        echo 'Prepare Homebrew. A previous attempt may have left partial files; its official installer may request administrator access in this terminal.'
        echo 'This changes shared host tools. Cancelling does not uninstall packages or undo host changes.'
        local revision=85d1a3fc80d8a63932f632aca8f787de11d14a64
        local expected=5f333bbe53bc490e51e7ccb1df8779b3dd6ee73a1a7379efda216edb08ccb148
        local url="https://raw.githubusercontent.com/Homebrew/install/$revision/install.sh"
        printf 'Source: %s\nSHA256: %s\n' "$url" "$expected"
        confirm 'Download, verify and run this Homebrew installer?' || return 1
        command -v curl >/dev/null || { echo 'curl is required to download Homebrew. Existing Node/npm can still use node install.mjs.' >&2; return 1; }
        if [ -n "$scratch" ]; then rm -rf -- "$scratch"; scratch=''; fi
        scratch=$(mktemp -d /tmp/gitjig-bootstrap.XXXXXX) || return 1
        echo 'Downloading Homebrew installer…'
        if ! curl --proto '=https' --tlsv1.2 --fail --location --connect-timeout 20 --max-time 120 --output "$scratch/install.sh" "$url"; then
            if retry_prerequisite; then continue; else return 1; fi
        fi
        local observed
        if command -v shasum >/dev/null; then observed=$(shasum -a 256 "$scratch/install.sh") || return 1;
        elif command -v sha256sum >/dev/null; then observed=$(sha256sum "$scratch/install.sh") || return 1;
        else echo 'A SHA256 checker (shasum or sha256sum) is required; downloaded code was not run.' >&2; return 1; fi
        if [ "${observed%% *}" != "$expected" ]; then
            echo 'Homebrew installer checksum mismatch; downloaded code was not run.' >&2
            if retry_prerequisite; then continue; else return 1; fi
        fi
        local began=$SECONDS
        if ! env -u NONINTERACTIVE -u INTERACTIVE -u CI /bin/bash "$scratch/install.sh"; then
            echo 'Homebrew installation did not complete. Partial host changes may remain; inspect its output and rerun to continue.' >&2
            if retry_prerequisite; then continue; else return 1; fi
        fi
        printf 'Homebrew installation finished · %ss\n' "$((SECONDS-began))"
        if find_brew; then return; fi
        echo 'Homebrew did not create a usable command. Inspect its output.' >&2
        if ! retry_prerequisite; then return 1; fi
    done
}
compatible_node() {
    node_bin=$(command -v node || true)
    [ -n "$node_bin" ] && [ -x "$node_bin" ] || return 1
    "$node_bin" -e 'const v=process.versions.node.split(".").map(Number);process.exit(v[0]>22||v[0]===22&&(v[1]>19||v[1]===19&&v[2]>=0)?0:1)' || return 1
    command -v npm >/dev/null
}
if ! compatible_node; then
    echo 'Gitjig needs Node >=22.19.0 and npm. Existing Node installations will not be overwritten.'
    confirm 'Prepare Node/npm with the Homebrew node@24 package?' || { echo 'No application installation started. Install compatible Node/npm or rerun this entry in a terminal.' >&2; exit 1; }
    ensure_brew || exit 1
    began=$SECONDS
    while ! "$brew_bin" install node@24; do
        if ! retry_prerequisite; then exit 1; fi
    done
    node_prefix=$("$brew_bin" --prefix node@24)
    case "$node_prefix" in /*) ;; *) echo 'Homebrew returned a non-absolute Node prefix' >&2; exit 1 ;; esac
    export PATH="$node_prefix/bin:$PATH"
    compatible_node || { echo 'Node/npm preparation did not produce compatible tools; inspect Homebrew output.' >&2; exit 1; }
    printf 'Node/npm prepared · %ss\n' "$((SECONDS-began))"
    printf 'This terminal will use %s. Future terminals still need this Node bin directory on PATH: %s/bin\n' "$node_bin" "$node_prefix"
fi
export PATH="$(dirname -- "$node_bin"):$PATH"
# Offer prerequisite provisioning while the original terminal owns password input.
# App runtime setup stays model-free and never captures administrator passwords.
if ! command -v docker >/dev/null && ! find_brew; then
    if confirm 'No Docker client found. Prepare Homebrew for optional Colima runtime setup?'; then ensure_brew || exit 1; fi
fi
if find_brew; then export PATH="$(dirname -- "$brew_bin"):$PATH"; fi
printf 'Starting gitjig installer with %s\n' "$node_bin"
if [ -n "$scratch" ]; then rm -rf -- "$scratch"; scratch=''; fi
exec "$node_bin" "$source_dir/install.mjs" "$@"
