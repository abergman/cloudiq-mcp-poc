# Crayon Cloud-iQ MCP Server

An MCP (Model Context Protocol) server that integrates with the [Crayon Cloud-iQ API](https://apidocs.crayon.com/) to manage organizations, customer tenants, and subscriptions.

## Features

| Tool | Description |
|------|-------------|
| `crayon_login` | Authenticate with OAuth2 Resource Password flow |
| `crayon_get_organizations` | List organizations for the authenticated user |
| `crayon_get_organization` | Get details of a specific organization |
| `crayon_get_customers` | List customer tenants for an organization |
| `crayon_get_customer` | Get detailed customer tenant info |
| `crayon_create_customer` | Create a new customer tenant |
| `crayon_get_subscriptions` | List subscriptions (filter by org, customer, status, etc.) |
| `crayon_get_subscription` | Get detailed subscription info |
| `crayon_get_invoice_profiles` | List invoice profiles (needed for customer creation) |
| `crayon_get_agreements` | List agreements for an organization |

## Prerequisites

1. A Crayon Cloud-iQ account with API access
2. A registered API client (Client ID + Client Secret) — register at https://cloudiq.crayon.com/clients/
3. An API user (username + password) — create at https://cloudiq.crayon.com/users/
4. Node.js 18+

## Setup

```bash
npm install
npm run build
```

## Configuration

Credentials can be provided in two ways:

### Option A: Environment variables

Set these before starting the server:

```
CRAYON_CLIENT_ID=your-client-id
CRAYON_CLIENT_SECRET=your-client-secret
CRAYON_USERNAME=your-api-username
CRAYON_PASSWORD=your-api-password
```

With env vars set, just call `crayon_login` with no arguments.

### Option B: Pass credentials to the login tool

Call `crayon_login` with `clientId`, `clientSecret`, `username`, and `password` arguments.

## VS Code / Copilot Configuration

Add to your `.vscode/mcp.json` (or user `settings.json` under `mcp.servers`):

```json
{
  "servers": {
    "crayon-cloudiq": {
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "c:\\Users\\AndreasBergman\\CiQ MCP",
      "env": {
        "CRAYON_CLIENT_ID": "your-client-id",
        "CRAYON_CLIENT_SECRET": "your-client-secret",
        "CRAYON_USERNAME": "your-api-username",
        "CRAYON_PASSWORD": "your-api-password"
      }
    }
  }
}
```

## Usage Flow

1. **Login** — call `crayon_login` to authenticate
2. **Choose organization** — call `crayon_get_organizations` to list available orgs
3. **List customers** — call `crayon_get_customers` with the chosen `organizationId`
4. **Add a customer** — call `crayon_create_customer` (requires invoice profile ID — use `crayon_get_invoice_profiles` first)
5. **View subscriptions** — call `crayon_get_subscriptions` filtered by org or customer tenant ID
6. **Subscription details** — call `crayon_get_subscription` with a specific subscription ID

## API Reference

Based on the [Crayon API Documentation](https://apidocs.crayon.com/). The server targets the REST API at `https://api.crayon.com/api/v1/`.
