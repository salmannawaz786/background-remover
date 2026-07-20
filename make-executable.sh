#!/bin/bash
# Make deployment scripts executable

echo "Making deployment scripts executable..."

chmod +x oracle-deploy/setup-oracle.sh
chmod +x oracle-deploy/deploy.sh

echo "✅ Done!"
echo ""
echo "Scripts are now executable:"
echo "  - oracle-deploy/setup-oracle.sh"
echo "  - oracle-deploy/deploy.sh"
echo ""
echo "You can now run:"
echo "  sudo ./oracle-deploy/setup-oracle.sh   (on Oracle server)"
echo "  ./oracle-deploy/deploy.sh              (to deploy)"
