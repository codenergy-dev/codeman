---
title: runner-images: install-nodejs.sh at 82d1b86
url: https://github.com/actions/runner-images/blob/82d1b86ad393865982dd29535cb8d3adbc68e41e/images/ubuntu/scripts/build/install-nodejs.sh
created_at: 2026-10-19T13:36:10-03:00
updated_at: 2026-10-19T13:36:10-03:00
tool: docs/web/tools/github-repositories.md
license: MIT
---

# runner-images: install-nodejs.sh at 82d1b86

```bash
#!/bin/bash -e
################################################################################
##  File:  install-nodejs.sh
##  Desc:  Install Node.js LTS and related tooling (Gulp, Grunt)
################################################################################

# Source the helpers for use with the script
source $HELPER_SCRIPTS/install.sh

# Install default Node.js
default_version=$(get_toolset_value '.node.default')
curl -fsSL https://raw.githubusercontent.com/tj/n/master/bin/n -o ~/n
bash ~/n $default_version

# Install node modules
node_modules=$(get_toolset_value '.node_modules[].name')
npm install -g $node_modules

echo "Creating the symlink for [now] command to vercel CLI"
ln -s /usr/local/bin/vercel /usr/local/bin/now

# fix global modules installation as regular user
# related issue https://github.com/actions/runner-images/issues/3727
sudo chmod -R 777 /usr/local/lib/node_modules 
sudo chmod -R 777 /usr/local/bin

rm -rf ~/n

invoke_tests "Node" "Node.js"
```
