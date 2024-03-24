# Use the official Node.js 20 image as the base
FROM node:20

# Set the working directory inside the container
WORKDIR /

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install the dependencies
RUN npm install

# Copy the rest of the application code to the working directory
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port on which the server will run
EXPOSE 3000

# Start the server
CMD ["node", "build/server.js"]