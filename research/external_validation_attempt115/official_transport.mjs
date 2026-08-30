import { request as nodeHttpsRequest } from "node:https";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { clearTimeout as nodeClearTimeout, setTimeout as nodeSetTimeout } from "node:timers";
import {
  checkServerIdentity as nodeCheckServerIdentity,
  getCACertificates as nodeGetCACertificates,
} from "node:tls";
import { URL as NodeUrl } from "node:url";

import {
  EXTERNAL_ATTEMPT115_FETCH_TIMEOUT_MS,
  EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES,
} from "./acquisition.mjs";
import { EXTERNAL_ATTEMPT115_SOURCE_URL } from "./protocol.mjs";

export const EXTERNAL_ATTEMPT115_OFFICIAL_TRANSPORT_SCHEMA =
  "finly_attempt115_node_https_transport.v1";

const nativeHttpsRequest = nodeHttpsRequest;
const nativeCheckServerIdentity = (host, certificate) => {
  if (host !== "mba.tuck.dartmouth.edu") {
    return new Error("external Attempt115 TLS hostname changed");
  }
  return nodeCheckServerIdentity("mba.tuck.dartmouth.edu", certificate);
};
const bundledCertificateAuthorities = Object.freeze(nodeGetCACertificates("bundled"));
const NativeReadableStream = NodeReadableStream;
const nativeClearTimeout = nodeClearTimeout;
const nativeSetTimeout = nodeSetTimeout;
const NativeUrl = NodeUrl;
const EXPECTED_ACCEPT =
  "application/zip, application/x-zip-compressed, application/octet-stream";

function fail(message) {
  throw new TypeError(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function exactRequestEnvelope(url, options) {
  if (url !== EXTERNAL_ATTEMPT115_SOURCE_URL
    || !options || typeof options !== "object" || Array.isArray(options)
    || Object.getPrototypeOf(options) !== Object.prototype) {
    fail("external Attempt115 native transport request envelope changed");
  }
  const keys = Object.keys(options).sort();
  const expectedKeys = [
    "cache",
    "credentials",
    "headers",
    "method",
    "redirect",
    "referrerPolicy",
    "signal",
  ].sort();
  const headers = options.headers;
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)
    || options.method !== "GET"
    || options.redirect !== "error"
    || options.cache !== "no-store"
    || options.credentials !== "omit"
    || options.referrerPolicy !== "no-referrer"
    || !headers || Object.getPrototypeOf(headers) !== Object.prototype
    || JSON.stringify(Object.keys(headers).sort())
      !== JSON.stringify(["accept", "accept-encoding"])
    || headers.accept !== EXPECTED_ACCEPT
    || headers["accept-encoding"] !== "identity"
    || !options.signal || typeof options.signal.addEventListener !== "function") {
    fail("external Attempt115 native transport request controls changed");
  }
}

function normalizedRawHeaderPairs(rawHeaders) {
  if (!Array.isArray(rawHeaders) || rawHeaders.length === 0 || rawHeaders.length % 2 !== 0) {
    fail("external Attempt115 native response raw headers are invalid");
  }
  const pairs = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    pairs.push(Object.freeze([String(rawHeaders[index]), String(rawHeaders[index + 1])]));
  }
  return Object.freeze(pairs);
}

function headerIterator(pairs) {
  return Object.freeze({
    entries() {
      return pairs.map(([name, value]) => [name, value])[Symbol.iterator]();
    },
  });
}

function strictBodyStream(response, declaredLength, onComplete, onFailure) {
  const iterator = response[Symbol.asyncIterator]();
  let terminal = false;
  let observedBytes = 0;
  const terminate = (controller, error) => {
    if (terminal) return;
    terminal = true;
    onFailure();
    const reason = error instanceof Error ? error : new Error(String(error));
    response.destroy(reason);
    controller.error(reason);
  };
  return new NativeReadableStream({
    async pull(controller) {
      if (terminal) return;
      try {
        const { done, value } = await iterator.next();
        if (done) {
          if (response.complete !== true || response.rawTrailers.length !== 0) {
            terminate(controller, new Error(
              "external Attempt115 native response is incomplete or contains trailers",
            ));
            return;
          }
          if (declaredLength !== null && observedBytes !== declaredLength) {
            terminate(controller, new Error(
              "external Attempt115 native response differs from its declared length",
            ));
            return;
          }
          terminal = true;
          onComplete(observedBytes);
          controller.close();
          return;
        }
        const chunk = new Uint8Array(value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ));
        observedBytes += chunk.byteLength;
        if (observedBytes > EXTERNAL_ATTEMPT115_MAX_ARCHIVE_BYTES) {
          terminate(controller, new Error(
            "external Attempt115 native response exceeds the archive byte limit",
          ));
          return;
        }
        controller.enqueue(chunk);
      } catch (error) {
        terminate(controller, error);
      }
    },
    async cancel(reason) {
      if (terminal) return;
      terminal = true;
      onFailure();
      try {
        await iterator.return?.();
      } finally {
        response.destroy(reason instanceof Error ? reason : new Error(String(reason)));
      }
    },
  }, { highWaterMark: 0 });
}

/**
 * Construct the sole production transport. It uses captured Node built-ins,
 * never global fetch, performs no redirect handling, and exposes one GET call.
 */
export function createExternalAttempt115OfficialTransport() {
  let invocationCount = 0;
  let evidence = null;
  let responseCompleted = false;
  let activeRequest = null;
  let activeResponse = null;
  let activeTimer = null;
  const fetch = async (url, options) => {
    exactRequestEnvelope(url, options);
    invocationCount += 1;
    if (invocationCount !== 1) {
      fail("external Attempt115 native transport permits exactly one API invocation");
    }
    const target = new NativeUrl(EXTERNAL_ATTEMPT115_SOURCE_URL);
    return new Promise((resolve, reject) => {
      let settled = false;
      let fullRequestTimer;
      const request = nativeHttpsRequest(target, {
        method: "GET",
        agent: false,
        setDefaultHeaders: false,
        setHost: false,
        headers: {
          host: target.host,
          accept: EXPECTED_ACCEPT,
          "accept-encoding": "identity",
          connection: "close",
        },
        minVersion: "TLSv1.2",
        maxVersion: "TLSv1.3",
        rejectUnauthorized: true,
        servername: target.hostname,
        checkServerIdentity: nativeCheckServerIdentity,
        ALPNProtocols: ["http/1.1"],
        insecureHTTPParser: false,
        maxHeaderSize: 16 * 1024,
        joinDuplicateHeaders: false,
        signal: options.signal,
        ca: bundledCertificateAuthorities,
      }, (response) => {
        activeResponse = response;
        try {
          const socket = response.socket;
          const certificate = socket.getPeerCertificate?.() ?? {};
          const protocol = socket.getProtocol?.() ?? null;
          if (response.statusCode !== 200 || response.httpVersion !== "1.1"
            || socket.authorized !== true || !["TLSv1.2", "TLSv1.3"].includes(protocol)
            || ![false, "http/1.1"].includes(socket.alpnProtocol)) {
            response.destroy();
            fail("external Attempt115 native transport response or TLS identity failed");
          }
          const pairs = normalizedRawHeaderPairs(response.rawHeaders);
          const contentLengths = pairs
            .filter(([name]) => name.toLowerCase() === "content-length")
            .map(([, value]) => value.trim());
          const declaredLength = contentLengths.length === 1
            && /^(?:0|[1-9]\d*)$/u.test(contentLengths[0])
            ? Number(contentLengths[0])
            : null;
          evidence = deepFreeze({
            schema_version: EXTERNAL_ATTEMPT115_OFFICIAL_TRANSPORT_SCHEMA,
            implementation: "captured node:https.request",
            api_invocation_count: invocationCount,
            physical_http_or_tcp_request_count_attested: false,
            request: {
              url: EXTERNAL_ATTEMPT115_SOURCE_URL,
              method: "GET",
              redirect_mode: "error",
              cache_mode: "no-store",
              credentials_mode: "omit",
              referrer_policy: "no-referrer",
              accept: EXPECTED_ACCEPT,
              redirects_followed: false,
              accept_encoding: "identity",
              connection_reuse_permitted: false,
              timeout_ms: EXTERNAL_ATTEMPT115_FETCH_TIMEOUT_MS,
            },
            response: {
              status: response.statusCode,
              final_url: EXTERNAL_ATTEMPT115_SOURCE_URL,
              redirected: false,
              http_version: response.httpVersion,
              tls_authorized: socket.authorized,
              tls_protocol: protocol,
              peer_certificate_fingerprint256: certificate.fingerprint256 ?? null,
              remote_address: socket.remoteAddress ?? null,
              raw_header_field_count: pairs.length,
              alpn_protocol: socket.alpnProtocol || null,
              response_complete: false,
              trailers_present: false,
            },
            trust_boundary: {
              standard_node_pki_validation: true,
              provider_payload_signature_verified: false,
              provider_signature_available_to_transport: false,
            },
          });
          const body = strictBodyStream(response, declaredLength, (observedBytes) => {
            responseCompleted = true;
            nativeClearTimeout(fullRequestTimer);
            activeTimer = null;
            activeRequest = null;
            activeResponse = null;
            if (evidence.response.status === 200) {
              evidence = deepFreeze({
                ...evidence,
                response: {
                  ...evidence.response,
                  observed_body_byte_count: observedBytes,
                  response_complete: true,
                },
              });
            }
          }, () => {
            nativeClearTimeout(fullRequestTimer);
            activeTimer = null;
            activeRequest = null;
            activeResponse = null;
          });
          settled = true;
          resolve({
            status: response.statusCode,
            ok: response.statusCode === 200,
            redirected: false,
            url: EXTERNAL_ATTEMPT115_SOURCE_URL,
            headers: headerIterator(pairs),
            body,
          });
        } catch (error) {
          nativeClearTimeout(fullRequestTimer);
          response.destroy(error);
          request.destroy(error);
          settled = true;
          reject(error);
        }
      });
      request.setTimeout(EXTERNAL_ATTEMPT115_FETCH_TIMEOUT_MS, () => {
        request.destroy(new Error("external Attempt115 native HTTPS timeout"));
      });
      request.once("error", (error) => {
        nativeClearTimeout(fullRequestTimer);
        if (!settled) reject(error);
      });
      request.once("information", () => {
        request.destroy(new Error(
          "external Attempt115 native transport forbids informational responses",
        ));
      });
      request.once("upgrade", (_response, socket) => {
        socket.destroy();
        request.destroy(new Error("external Attempt115 native transport forbids upgrades"));
      });
      fullRequestTimer = nativeSetTimeout(() => {
        request.destroy(new Error("external Attempt115 native HTTPS full-request timeout"));
      }, EXTERNAL_ATTEMPT115_FETCH_TIMEOUT_MS);
      activeRequest = request;
      activeTimer = fullRequestTimer;
      request.end();
    });
  };
  return Object.freeze({
    fetch,
    cancelIncompleteResponse() {
      if (responseCompleted) return;
      nativeClearTimeout(activeTimer);
      activeTimer = null;
      activeResponse?.destroy();
      activeRequest?.destroy();
      activeResponse = null;
      activeRequest = null;
    },
    evidence() {
      if (invocationCount !== 1 || evidence === null || responseCompleted !== true) {
        fail("external Attempt115 native transport has no single completed response evidence");
      }
      return evidence;
    },
  });
}
