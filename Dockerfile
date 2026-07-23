FROM apify/actor-node:22

# Copy package files first for layer caching
COPY --chown=myuser:myuser package*.json ./

# Install production dependencies (impit's Rust binary ships via optionalDependencies — do NOT omit)
RUN npm --quiet set progress=false \
    && npm install --omit=dev \
    && node -e "import('impit').then(m => console.log('impit OK:', Object.keys(m)))" \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Copy all source files
COPY --chown=myuser:myuser . ./

CMD npm start --silent
