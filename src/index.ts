import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Crayon API Client ───────────────────────────────────────────────────────

const BASE_URL = process.env.CRAYON_BASE_URL ?? "https://api.crayon.com";

interface TokenState {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenState: TokenState | null = null;

async function getToken(
  clientId: string,
  clientSecret: string,
  username: string,
  password: string
): Promise<TokenState> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    scope: "CustomerApi",
  });

  const res = await fetch(`${BASE_URL}/api/v1/connect/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Authentication failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    AccessToken?: string;
    access_token?: string;
    ExpiresIn?: number;
    expires_in?: number;
  };

  const accessToken = data.AccessToken ?? data.access_token;
  const expiresIn = data.ExpiresIn ?? data.expires_in ?? 3600;

  if (!accessToken) {
    throw new Error("No access token in response");
  }

  return {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000 - 60_000, // 1 min buffer
  };
}

function ensureToken(): string {
  if (!tokenState || Date.now() >= tokenState.expiresAt) {
    throw new Error(
      "Not authenticated. Please call the crayon_login tool first."
    );
  }
  return tokenState.accessToken;
}

async function apiGet<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
  const token = ensureToken();
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API GET ${path} failed (${res.status}): ${text}`);
  }

  return (await res.json()) as T;
}

async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = ensureToken();
  const url = new URL(path, BASE_URL);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${path} failed (${res.status}): ${text}`);
  }

  return (await res.json()) as T;
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "crayon-cloudiq",
  version: "1.0.0",
});

// ─── Tool: Login ─────────────────────────────────────────────────────────────

server.tool(
  "crayon_login",
  "Authenticate with the Crayon Cloud-iQ API using OAuth2 Resource Password flow. " +
    "Credentials can be passed as arguments or read from environment variables " +
    "(CRAYON_CLIENT_ID, CRAYON_CLIENT_SECRET, CRAYON_USERNAME, CRAYON_PASSWORD).",
  {
    clientId: z.string().optional().describe("OAuth2 Client ID (falls back to env CRAYON_CLIENT_ID)"),
    clientSecret: z.string().optional().describe("OAuth2 Client Secret (falls back to env CRAYON_CLIENT_SECRET)"),
    username: z.string().optional().describe("API username (falls back to env CRAYON_USERNAME)"),
    password: z.string().optional().describe("API password (falls back to env CRAYON_PASSWORD)"),
  },
  async ({ clientId, clientSecret, username, password }) => {
    const cid = clientId ?? process.env.CRAYON_CLIENT_ID;
    const csec = clientSecret ?? process.env.CRAYON_CLIENT_SECRET;
    const user = username ?? process.env.CRAYON_USERNAME;
    const pass = password ?? process.env.CRAYON_PASSWORD;

    if (!cid || !csec || !user || !pass) {
      return {
        content: [
          {
            type: "text",
            text: "Missing credentials. Provide clientId, clientSecret, username, and password as arguments or set CRAYON_CLIENT_ID, CRAYON_CLIENT_SECRET, CRAYON_USERNAME, CRAYON_PASSWORD environment variables.",
          },
        ],
      };
    }

    try {
      tokenState = await getToken(cid, csec, user, pass);
      return {
        content: [
          {
            type: "text",
            text: `Successfully authenticated with Crayon Cloud-iQ API. Token valid until ${new Date(tokenState.expiresAt).toISOString()}.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Login failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Organizations ─────────────────────────────────────────────────

server.tool(
  "crayon_get_organizations",
  "List organizations accessible to the authenticated user. Use this to find the organization ID needed for other operations.",
  {
    search: z.string().optional().describe("Search by organization name"),
    page: z.number().optional().describe("Page number (starts at 1)"),
    pageSize: z.number().optional().describe("Number of results per page"),
  },
  async ({ search, page, pageSize }) => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (page) params.page = String(page);
      if (pageSize) params.pageSize = String(pageSize);

      const data = await apiGet("/api/v1/organizations/", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Organization ──────────────────────────────────────────────────

server.tool(
  "crayon_get_organization",
  "Get details of a specific organization by its ID.",
  {
    organizationId: z.number().describe("The organization ID"),
  },
  async ({ organizationId }) => {
    try {
      const data = await apiGet(`/api/v1/organizations/${organizationId}/`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Customers (Customer Tenants) ──────────────────────────────────

server.tool(
  "crayon_get_customers",
  "List customer tenants for an organization. Customer tenants represent end-customer companies connected to a license publisher.",
  {
    organizationId: z.number().describe("Organization ID to list customers for"),
    search: z.string().optional().describe("Search by customer name or reference"),
    page: z.number().optional().describe("Page number (starts at 1)"),
    pageSize: z.number().optional().describe("Number of results per page"),
    domainPrefix: z.string().optional().describe("Filter by domain prefix"),
    publisherId: z.number().optional().describe("Filter by publisher ID"),
    customerTenantType: z.number().optional().describe("Filter by tenant type: 1=T1, 2=T2"),
  },
  async ({ organizationId, search, page, pageSize, domainPrefix, publisherId, customerTenantType }) => {
    try {
      const params: Record<string, string> = {
        organizationId: String(organizationId),
      };
      if (search) params.search = search;
      if (page) params.page = String(page);
      if (pageSize) params.pageSize = String(pageSize);
      if (domainPrefix) params.domainPrefix = domainPrefix;
      if (publisherId) params.publisherId = String(publisherId);
      if (customerTenantType) params.customerTenantType = String(customerTenantType);

      const data = await apiGet("/api/v1/customertenants/", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Customer (Detailed) ──────────────────────────────────────────

server.tool(
  "crayon_get_customer",
  "Get detailed information about a specific customer tenant by ID, including profile, address, and company info.",
  {
    customerTenantId: z.number().describe("The customer tenant ID"),
  },
  async ({ customerTenantId }) => {
    try {
      const data = await apiGet(`/api/v1/customertenants/${customerTenantId}/detailed`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Create Customer Tenant ────────────────────────────────────────────

server.tool(
  "crayon_create_customer",
  "Create a new customer tenant (end-customer) under an organization. Requires organization ID, publisher ID, invoice profile ID, and customer details including address and contact info.",
  {
    // Tenant info
    name: z.string().describe("Customer company name"),
    domainPrefix: z.string().describe("Domain prefix for the customer (used in URLs, subscriptions, usernames)"),
    organizationId: z.number().describe("Organization ID this customer belongs to"),
    publisherId: z.number().describe("Publisher ID (e.g. 2 for Microsoft)"),
    invoiceProfileId: z.number().describe("Invoice profile ID for billing"),
    customerTenantType: z.number().default(2).describe("Tenant type: 1=T1, 2=T2 (default: 2)"),
    reference: z.string().optional().describe("Optional reference for the customer"),
    // Address
    addressFirstName: z.string().describe("Address first name"),
    addressLastName: z.string().describe("Address last name"),
    addressLine1: z.string().describe("Street address line 1"),
    addressLine2: z.string().optional().describe("Street address line 2"),
    city: z.string().describe("City"),
    region: z.string().describe("State/Region"),
    postalCode: z.string().describe("Postal/ZIP code"),
    countryCode: z.string().describe("ISO country code (e.g. US, SE, NO)"),
    // Contact
    contactFirstName: z.string().describe("Contact first name"),
    contactLastName: z.string().describe("Contact last name"),
    contactEmail: z.string().describe("Contact email address"),
    contactPhone: z.string().describe("Contact phone number"),
    // Company
    orgRegistrationNumber: z.string().describe("Company/organization registration number"),
  },
  async (args) => {
    try {
      const body = {
        Tenant: {
          Name: args.name,
          DomainPrefix: args.domainPrefix,
          CustomerTenantType: args.customerTenantType,
          Reference: args.reference ?? "",
          Organization: { Id: args.organizationId },
          Publisher: { Id: args.publisherId },
          InvoiceProfile: { Id: args.invoiceProfileId },
        },
        Profile: {
          Address: {
            FirstName: args.addressFirstName,
            LastName: args.addressLastName,
            AddressLine1: args.addressLine1,
            AddressLine2: args.addressLine2 ?? "",
            City: args.city,
            Region: args.region,
            PostalCode: args.postalCode,
            CountryCode: args.countryCode,
          },
          Contact: {
            FirstName: args.contactFirstName,
            LastName: args.contactLastName,
            Email: args.contactEmail,
            PhoneNumber: args.contactPhone,
          },
        },
        Company: {
          OrganizationRegistrationNumber: args.orgRegistrationNumber,
        },
      };

      const data = await apiPost("/api/v1/customertenants/", body);
      return {
        content: [
          {
            type: "text",
            text: `Customer tenant created successfully:\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating customer: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Subscriptions ─────────────────────────────────────────────────

server.tool(
  "crayon_get_subscriptions",
  "List subscriptions. Filter by organization, customer tenant, publisher, status, or search text. Returns subscription names, IDs, quantities, states, and product info.",
  {
    organizationId: z.number().optional().describe("Filter by organization ID"),
    customerTenantId: z.number().optional().describe("Filter by customer tenant ID"),
    publisherCustomerId: z.string().optional().describe("Filter by publisher customer ID"),
    publisherId: z.number().optional().describe("Filter by publisher ID"),
    search: z.string().optional().describe("Search by subscription name, ID, or product name"),
    page: z.number().optional().describe("Page number (starts at 1)"),
    pageSize: z.number().optional().describe("Number of results per page"),
    isTrial: z.boolean().optional().describe("Filter for trial subscriptions only"),
    statuses: z.string().optional().describe("Filter by status: 0=none, 1=active, 2=suspended, 4=deleted, 8=customerCancellation, 16=converted, 32=expired, 64=pending"),
  },
  async ({ organizationId, customerTenantId, publisherCustomerId, publisherId, search, page, pageSize, isTrial, statuses }) => {
    try {
      const params: Record<string, string> = {};
      if (organizationId) params.organizationId = String(organizationId);
      if (customerTenantId) params.customerTenantId = String(customerTenantId);
      if (publisherCustomerId) params.publisherCustomerId = publisherCustomerId;
      if (publisherId) params.publisherId = String(publisherId);
      if (search) params.search = search;
      if (page) params.page = String(page);
      if (pageSize) params.pageSize = String(pageSize);
      if (isTrial !== undefined) params.isTrial = String(isTrial);
      if (statuses) params.statuses = statuses;

      const data = await apiGet("/api/v1/subscriptions/", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Subscription (Detailed) ──────────────────────────────────────

server.tool(
  "crayon_get_subscription",
  "Get detailed information about a specific subscription by its ID, including status, product, dates, quantity, and add-ons.",
  {
    subscriptionId: z.number().describe("The subscription ID"),
  },
  async ({ subscriptionId }) => {
    try {
      const data = await apiGet(`/api/v1/subscriptions/${subscriptionId}/`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Invoice Profiles ──────────────────────────────────────────────

server.tool(
  "crayon_get_invoice_profiles",
  "List invoice profiles for an organization. Invoice profile IDs are required when creating customer tenants.",
  {
    organizationId: z.number().describe("Organization ID to list invoice profiles for"),
  },
  async ({ organizationId }) => {
    try {
      const data = await apiGet("/api/v1/invoiceprofiles/", {
        organizationId: String(organizationId),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Get Agreements ────────────────────────────────────────────────────

server.tool(
  "crayon_get_agreements",
  "List agreements for an organization. Agreements define the terms under which products can be purchased.",
  {
    organizationId: z.number().describe("Organization ID"),
    page: z.number().optional().describe("Page number (starts at 1)"),
    pageSize: z.number().optional().describe("Number of results per page"),
  },
  async ({ organizationId, page, pageSize }) => {
    try {
      const params: Record<string, string> = {
        organizationId: String(organizationId),
      };
      if (page) params.page = String(page);
      if (pageSize) params.pageSize = String(pageSize);

      const data = await apiGet("/api/v1/agreements/", params);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Tool: Top 10 Tenants by Subscription Quantity ───────────────────────────

server.tool(
  "crayon_top_tenants_by_subscriptions",
  "Get the top 10 biggest customer tenants ranked by total subscription quantity for an organization. " +
    "Fetches all tenants and their active subscriptions in one go, sums up seat/license quantities per tenant, " +
    "and returns the top 10 sorted descending by total quantity.",
  {
    organizationId: z.number().describe("Organization ID to analyze"),
    publisherId: z.number().optional().describe("Optional publisher ID filter (e.g. 2 for Microsoft)"),
  },
  async ({ organizationId, publisherId }) => {
    try {
      // Step 1: Fetch all customer tenants (paginate through all pages)
      interface CustomerTenant {
        Id: number;
        Name: string;
        DomainPrefix?: string;
        Reference?: string;
      }

      interface PagedResult<T> {
        Items: T[];
        TotalCount: number;
      }

      interface Subscription {
        Id: number;
        Name?: string;
        Quantity: number;
        Status?: number;
      }

      const allTenants: CustomerTenant[] = [];
      let page = 1;
      const pageSize = 100;
      let totalCount = 0;

      do {
        const params: Record<string, string> = {
          organizationId: String(organizationId),
          page: String(page),
          pageSize: String(pageSize),
        };
        if (publisherId) params.publisherId = String(publisherId);

        const result = await apiGet<PagedResult<CustomerTenant>>(
          "/api/v1/customertenants/",
          params
        );

        allTenants.push(...(result.Items ?? []));
        totalCount = result.TotalCount ?? allTenants.length;
        page++;
      } while (allTenants.length < totalCount);

      if (allTenants.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No customer tenants found for this organization.",
            },
          ],
        };
      }

      // Step 2: Fetch subscriptions for all tenants in parallel
      const tenantSubscriptionCounts = await Promise.all(
        allTenants.map(async (tenant) => {
          let totalQuantity = 0;
          let subscriptionCount = 0;
          let subPage = 1;
          let subTotalCount = 0;

          try {
            do {
              const subParams: Record<string, string> = {
                customerTenantId: String(tenant.Id),
                page: String(subPage),
                pageSize: "100",
                statuses: "1", // active only
              };
              if (publisherId) subParams.publisherId = String(publisherId);

              const subs = await apiGet<PagedResult<Subscription>>(
                "/api/v1/subscriptions/",
                subParams
              );

              for (const sub of subs.Items ?? []) {
                totalQuantity += sub.Quantity ?? 0;
                subscriptionCount++;
              }

              subTotalCount = subs.TotalCount ?? 0;
              subPage++;
            } while (subscriptionCount < subTotalCount);
          } catch {
            // If subscription fetch fails for a tenant, record 0
          }

          return {
            tenantId: tenant.Id,
            tenantName: tenant.Name,
            domainPrefix: tenant.DomainPrefix ?? "",
            reference: tenant.Reference ?? "",
            totalQuantity,
            subscriptionCount,
          };
        })
      );

      // Step 3: Sort by total quantity descending and take top 10
      const top10 = tenantSubscriptionCounts
        .sort((a, b) => b.totalQuantity - a.totalQuantity)
        .slice(0, 10);

      const summary = [
        `Top 10 Tenants by Subscription Quantity (Organization ${organizationId})`,
        `Total tenants analyzed: ${allTenants.length}`,
        `─────────────────────────────────────────`,
        ...top10.map(
          (t, i) =>
            `${i + 1}. ${t.tenantName} (ID: ${t.tenantId})` +
            `\n   Domain: ${t.domainPrefix}` +
            (t.reference ? `  |  Ref: ${t.reference}` : "") +
            `\n   Subscriptions: ${t.subscriptionCount}  |  Total Quantity: ${t.totalQuantity}`
        ),
      ].join("\n");

      return {
        content: [{ type: "text", text: summary }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
