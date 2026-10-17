# Maintainer: Diego
pkgname=markline
pkgver=0.1.0
pkgrel=1
pkgdesc='WYSIWYG markdown editor with visual Mermaid diagram editing (Tauri)'
arch=('x86_64')
license=('custom')
depends=('webkit2gtk-4.1' 'gtk3')
makedepends=('rust' 'nodejs' 'npm')
source=()
options=('!debug')

build() {
  cd "$startdir"
  npm install --no-audit --no-fund
  node build-app.js
  npx tauri build --no-bundle
}

package() {
  cd "$startdir"
  install -Dm755 src-tauri/target/release/markline "$pkgdir/usr/bin/markline"
  install -Dm644 src-tauri/icons/icon.png "$pkgdir/usr/share/icons/hicolor/256x256/apps/markline.png"
  install -Dm644 src-tauri/markline.desktop "$pkgdir/usr/share/applications/markline.desktop"
}
