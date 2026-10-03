#!/bin/bash
# Double-clic sur macOS : lance TV Monde et ouvre le navigateur.
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 n'est pas installé. Une fenêtre va proposer de l'installer."
  xcode-select --install 2>/dev/null
  read -r -p "Relance ce fichier une fois l'installation terminée. (Entrée pour fermer)"
  exit 1
fi
python3 server.py
