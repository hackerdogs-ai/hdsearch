// Multi-language API examples for the in-product docs. Pure data (no server-only),
// parameterized by the API base URL. Languages: curl, Python, Node, TypeScript, Go, C#.
import type { Snippet } from '@/components/code-tabs';

const KEY = 'sk-hds-YOUR_KEY';

function set(api: string, path: string, body: string): Snippet[] {
  const bodyPretty = body;
  // compact single-line JSON for curl/Go/C# string literals
  const bodyMin = JSON.stringify(JSON.parse(body));
  const url = `${api}${path}`;
  return [
    {
      lang: 'curl',
      label: 'cURL',
      code: `curl ${url} \\
  -H "authorization: Bearer ${KEY}" \\
  -H "content-type: application/json" \\
  -d '${bodyMin}'`,
    },
    {
      lang: 'python',
      label: 'Python',
      code: `import requests

r = requests.post(
    "${url}",
    headers={"authorization": "Bearer ${KEY}"},
    json=${pyDict(body)},
    timeout=30,
)
r.raise_for_status()
print(r.json())`,
    },
    {
      lang: 'node',
      label: 'Node.js',
      code: `// Node 18+ (global fetch)
const res = await fetch("${url}", {
  method: "POST",
  headers: {
    authorization: "Bearer ${KEY}",
    "content-type": "application/json",
  },
  body: JSON.stringify(${bodyPretty}),
});
if (!res.ok) throw new Error("HTTP " + res.status);
const data = await res.json();
console.log(data);`,
    },
    {
      lang: 'ts',
      label: 'TypeScript',
      code: `interface SearchResponse {
  results: { title: string; url: string; snippet?: string; source: string; score?: number }[];
  total: number;
  enginesUsed: { engine: string; ok: boolean; count: number }[];
}

const res = await fetch("${url}", {
  method: "POST",
  headers: { authorization: "Bearer ${KEY}", "content-type": "application/json" },
  body: JSON.stringify(${bodyPretty}),
});
const data = (await res.json()) as SearchResponse;
console.log(data.results.slice(0, 5));`,
    },
    {
      lang: 'go',
      label: 'Go',
      code: `package main

import (
\t"bytes"
\t"fmt"
\t"io"
\t"net/http"
)

func main() {
\tbody := []byte(\`${bodyMin}\`)
\treq, _ := http.NewRequest("POST", "${url}", bytes.NewBuffer(body))
\treq.Header.Set("Authorization", "Bearer ${KEY}")
\treq.Header.Set("Content-Type", "application/json")
\tresp, err := http.DefaultClient.Do(req)
\tif err != nil { panic(err) }
\tdefer resp.Body.Close()
\tout, _ := io.ReadAll(resp.Body)
\tfmt.Println(string(out))
}`,
    },
    {
      lang: 'csharp',
      label: 'C#',
      code: `using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;

using var http = new HttpClient();
http.DefaultRequestHeaders.Authorization =
    new AuthenticationHeaderValue("Bearer", "${KEY}");

var json = ${csharpString(bodyMin)};
var content = new StringContent(json, Encoding.UTF8, "application/json");
var resp = await http.PostAsync("${url}", content);
resp.EnsureSuccessStatusCode();
Console.WriteLine(await resp.Content.ReadAsStringAsync());`,
    },
  ];
}

// helpers to render the body in language-idiomatic form
function pyDict(jsonBody: string): string {
  const obj = JSON.parse(jsonBody);
  return JSON.stringify(obj, null, 4)
    .replace(/: true/g, ': True')
    .replace(/: false/g, ': False')
    .replace(/: null/g, ': None');
}
function csharpString(min: string): string {
  return '"' + min.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function searchSnippets(api: string): Snippet[] {
  return set(api, '/v1/search', '{"q":"vector database","modality":"web","mode":"aggregate","facets":true,"limit":10}');
}
export function crawlSnippets(api: string): Snippet[] {
  return set(api, '/v1/crawl', '{"url":"https://example.com","formats":["markdown","links"],"render":false}');
}
export function vectorSnippets(api: string): Snippet[] {
  return set(api, '/v1/search/vector', '{"q":"time series database","namespace":"notes","k":5,"groundWithWeb":true}');
}
// Force a specific engine instead of the priority-ordered default. Any id from
// GET /v1/engines works (free: searxng, openserp, duckduckgo, wikipedia, gdelt,
// commoncrawl, ahmia; commercial need a key: brave, serpapi, serper, tavily, exa, kagi).
export function engineSnippets(api: string): Snippet[] {
  return set(api, '/v1/search', '{"q":"vector database","engine":"searxng","modality":"web","limit":10}');
}
// List the engines available to you (and whether each is usable with your keys).
export function listEnginesSnippet(api: string): string {
  return `curl ${api}/v1/engines \\
  -H "authorization: Bearer ${KEY}"
# filter:  ${api}/v1/engines?category=search   (or crawl, darkweb)
#          ${api}/v1/engines?modality=images`;
}
