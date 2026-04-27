# Using Node 22 (LTS as of 2026)
FROM node:22-alpine

WORKDIR /usr/src/app

# Install dependencies first (for better caching)
COPY package*.json ./
RUN npm install

# Copy the rest of the source code
COPY . .

# Expose the port
EXPOSE 5000

# Dev command
CMD ["npm", "run", "dev"]