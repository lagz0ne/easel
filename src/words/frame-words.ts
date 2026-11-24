import { operation } from "@tinkered/core";
import { z } from "zod";

import { boardKit } from "@/kit/cells";
import { frameAxes } from "@/kit/compose";
import { teamTexts } from "@/kit/texts";

export const firstLocale = "en";

export const missingMark = "easel-missing";

export const isolateStart = "\u2068";

export const isolateEnd = "\u2069";

export const wordsScript = String.raw`<script>(()=>{const d=JSON.parse(document.getElementById("easel-words-data").textContent);const loc=d.locale;const texts=d.texts;const h=window.Highlight&&window.CSS&&CSS.highlights?new Highlight():null;if(h)CSS.highlights.set("easel-missing",h);const range=(n,a,b)=>{if(!h)return;const r=new Range();r.setStart(n,a);r.setEnd(n,b);h.add(r)};const whole=(el)=>{if(!h)return;const r=new Range();r.selectNodeContents(el);h.add(r)};const said=(text,el)=>{const c=el.getAttribute("data-easel-count");const n=c===null?NaN:Number(c);const form=typeof text==="string"?text:Number.isFinite(n)&&new Intl.PluralRules(loc).select(n)==="one"?text.one:text.other;return Number.isFinite(n)?form.replaceAll("{count}",new Intl.NumberFormat(loc).format(n)):form};const fill=()=>{for(const el of document.querySelectorAll("[data-easel-text]")){const t=texts[(el.getAttribute("data-easel-text")||"").trim()];const own=t?t[loc]:undefined;if(t)el.textContent=said(own===undefined?t.en:own,el);if(loc!=="en"&&own===undefined)whole(el)}};const skip="[data-easel-text],script,style,template,noscript,textarea";const walk=(plain)=>{if(!document.body)return;const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){const p=n.parentElement;if(!p||p.closest(skip))continue;if(plain){if(/\p{L}/u.test(n.data))range(n,0,n.data.length);continue}for(let a=n.data.indexOf("\u2068");a>=0;a=n.data.indexOf("\u2068",a+1)){const b=n.data.indexOf("\u2069",a);if(b>a)range(n,a+1,b)}}};const run=()=>{document.documentElement.lang=loc;if(texts){fill();if(loc!=="en")walk(true);return}let q=0;const again=()=>{q=0;if(h)h.clear();walk(false)};new MutationObserver(()=>{if(!q)q=requestAnimationFrame(again)}).observe(document.body||document.documentElement,{childList:true,subtree:true,characterData:true});again()};if(document.readyState==="loading")addEventListener("DOMContentLoaded",run);else run()})()</script>`;

export const wordsStyle = `<style id="easel-words">::highlight(${missingMark}){text-decoration:underline wavy #8f5600;text-decoration-skip-ink:none;text-underline-offset:2px}</style>`;

const keyedElement = /\bdata-easel-text\s*=/i;

const leadingDoctype = /^\uFEFF?\s*<!doctype[^>]*>\s*/i;

export const wordsKey = operation({
  label: "words.wordsKey",
  input: z.object({ html: z.string(), app: z.boolean(), locale: z.string(), kit: z.number() }),
  run: (_, { input: { html, app, locale, kit } }) => {
    const keyed = !app && keyedElement.test(html);
    if (locale === firstLocale && !keyed) return "";

    return app ? locale : `${locale}:${kit}`;
  },
});

export const frameWords = operation({
  label: "words.frameWords",
  input: z.object({
    html: z.string(),
    app: z.boolean(),
    locale: z.string(),
    texts: teamTexts.nullable(),
  }),
  depends: { wordsKey },
  run: ({ wordsKey }, { input: { html, app, locale, texts } }) => {
    if (wordsKey.run({ input: { html, app, locale, kit: 0 } }) === "") return html;

    const given = { locale, texts: app ? null : (texts ?? {}) };
    const words =
      `${wordsStyle}\n<script type="application/json" id="easel-words-data">` +
      `${JSON.stringify(given).replaceAll("<", "\\u003c")}</script>\n${wordsScript}\n`;
    const doctype = leadingDoctype.exec(html)?.[0] ?? "";
    return `${doctype}${words}${html.slice(doctype.length)}`;
  },
});

export const wordsFor = operation({
  label: "words.wordsFor",
  input: z.object({
    html: z.string(),
    app: z.boolean(),
    axes: frameAxes.nullable(),
    picked: z.string().nullable(),
    kit: boardKit.nullable(),
  }),
  depends: { wordsKey },
  run: ({ wordsKey }, { input: { html, app, axes, picked, kit } }) => {
    const locale = (app ? axes?.locale : picked) ?? firstLocale;
    const key = wordsKey.run({ input: { html, app, locale, kit: kit?.kit ?? 0 } });
    return { locale, key, texts: kit?.texts ?? null };
  },
});
