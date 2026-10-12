"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import type { Endpoint, ErrorCase, Param } from "./content";
import s from "./Docs.module.css";

export type Lang = "ts" | "sh" | "json" | "js";

const KEYWORDS = /^(import|from|const|await|async|new|return|export|function|let|if|else|for|of|true|false|null)$/;

export function highlight(code: string, lang: Lang): ReactNode[] {
  const re =
    lang === "json"
      ? /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d[\d.eE+-]*\b)|\b(true|false|null)\b/g
      : lang === "sh"
        ? /(#[^\n]*)|("[^"]*"|'[^']*')|(\s-{1,2}[A-Za-z][\w-]*)|(\bcurl\b)/g
        : /(\/\/[^\n]*)|("[^"]*"|'[^']*'|`[^`]*`)|(\b\d[\d_]*\b)|([A-Za-z_$][\w$]*)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    let cls: string | null = null;
    if (lang === "json") cls = m[1] ? (m[2] ? s.k : s.s) : m[3] ? s.n : s.k;
    else if (lang === "sh") cls = m[1] ? s.c : m[2] ? s.s : s.k;
    else cls = m[1] ? s.c : m[2] ? s.s : m[3] ? s.n : m[4] && KEYWORDS.test(m[4]) ? s.k : null;
    out.push(cls ? <span key={i++} className={cls}>{m[0]}</span> : m[0]);
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

const LANG_LABEL: Record<Lang, string> = { ts: "TypeScript", js: "JavaScript", sh: "Shell", json: "JSON" };

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 2_000);
  };
  return (
    <button type="button" className={s.copy} onClick={copy}>
      {state === "ok" ? "Copied" : state === "fail" ? "Copy failed" : label}
      <span className="sr-only" role="status">
        {state === "ok" ? "Copied to the clipboard" : state === "fail" ? "Copy failed. Select the text and copy it by hand." : ""}
      </span>
    </button>
  );
}

// Longer blocks start collapsed to COLLAPSED_LINES with a fade; the copy
// button always copies the whole block.
const COLLAPSE_ABOVE = 14;

export function CodeBlock({ code, lang, title }: { code: string; lang: Lang; title?: string }) {
  const id = useId();
  const figure = useRef<HTMLElement>(null);
  const lines = code.split("\n").length;
  const collapsible = lines > COLLAPSE_ABOVE;
  const [open, setOpen] = useState(false);
  const toggle = () => {
    setOpen((o) => !o);
    const top = figure.current?.getBoundingClientRect().top ?? 0;
    if (open && top < 0) {
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      figure.current?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
    }
  };
  return (
    <figure ref={figure} className={`${s.code} ${collapsible && !open ? s.collapsed : ""}`}>
      <figcaption className={s.codeHead}>
        <span>{title ?? LANG_LABEL[lang]}</span>
        <CopyButton text={code} />
      </figcaption>
      <div className={s.codeBody}>
        <pre id={id} tabIndex={0}>
          <code>{highlight(code, lang)}</code>
        </pre>
      </div>
      {collapsible && (
        <button type="button" className={s.more} aria-expanded={open} aria-controls={id} onClick={toggle}>
          {open ? "Show less" : `Show all ${lines} lines`}
        </button>
      )}
    </figure>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return <span className={`${s.method} ${method === "GET" ? s.get : s.post}`}>{method}</span>;
}

export function ParamTable({ params }: { params: Param[] }) {
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">In</th>
          <th scope="col">Type</th>
          <th scope="col">Required</th>
          <th scope="col">Default</th>
          <th scope="col">Details</th>
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.in + p.name}>
            <td data-label="Name">
              <code>{p.name}</code>
            </td>
            <td data-label="In">{p.in}</td>
            <td data-label="Type">{p.type}</td>
            <td data-label="Required">{p.required ? "yes" : "no"}</td>
            <td data-label="Default">{p.default ? <code>{p.default}</code> : ""}</td>
            <td data-label="Details">{p.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ErrorTable({ errors }: { errors: ErrorCase[] }) {
  return (
    <table className={`${s.table} ${s.errors}`}>
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">When</th>
        </tr>
      </thead>
      <tbody>
        {errors.map((e) => (
          <tr key={e.status + e.when}>
            <td data-label="Status">
              <code>{e.status}</code>
            </td>
            <td data-label="When">{e.when}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EndpointBlock({ e, base }: { e: Endpoint; base: string }) {
  return (
    <article id={e.id} className={s.endpoint} aria-labelledby={`${e.id}-title`}>
      <div className={s.endpointHead}>
        <MethodBadge method={e.method} />
        <code className={s.path}>{e.path}</code>
        <a className={s.anchor} href={`#${e.id}`} aria-label={`Link to ${e.method} ${e.path}`}>
          #
        </a>
      </div>
      <h3 id={`${e.id}-title`} className={`h3 ${s.endpointTitle}`}>
        {e.title}
      </h3>
      {e.purpose.map((p) => (
        <p key={p.slice(0, 32)} className={s.prose}>
          {p}
        </p>
      ))}
      {e.params && (
        <>
          <h4 className={s.minor}>Parameters</h4>
          <ParamTable params={e.params} />
        </>
      )}
      <h4 className={s.minor}>Request</h4>
      <CodeBlock code={e.curl(base)} lang="sh" title="curl" />
      {e.example !== undefined && (
        <>
          <h4 className={s.minor}>Example response</h4>
          <p className={s.note}>Illustrative, not a live response.{e.exampleNote ? ` ${e.exampleNote}` : ""}</p>
          <CodeBlock code={JSON.stringify(e.example, null, 2)} lang="json" title="JSON example" />
        </>
      )}
      {e.example === undefined && e.exampleNote && <p className={s.note}>{e.exampleNote}</p>}
      {e.fields && (
        <>
          <h4 className={s.minor}>Fields</h4>
          <dl className={s.fields}>
            {e.fields.map((f) => (
              <div key={f.name}>
                <dt>
                  <code>{f.name}</code>
                </dt>
                <dd>{f.detail}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {e.errors && (
        <>
          <h4 className={s.minor}>Errors</h4>
          <ErrorTable errors={e.errors} />
        </>
      )}
    </article>
  );
}
