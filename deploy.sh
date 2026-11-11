
#!/usr/bin/env bash
# Deploy absensi-web ke Vercel (production).
# Pakai: cd "$(dirname "$0")" && ./deploy.sh
set -e
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

if [ ! -f .vercel/project.json ]; then
  echo "Project belum di-link. Jalankan:"
  echo "  vercel link --yes --team erickv7-uis-projects --project absensi-web"
  exit 1
fi

npm install --no-audit --no-fund
vercel --prod --yes
