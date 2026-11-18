"use client";

import { useEffect, useRef, useState } from "react";
import type { Worker as OcrWorker } from "tesseract.js";
import { splitOcrQuestions } from "@/lib/ocr-questions";
import "./image-ocr.css";

type Props = { image: () => Promise<Blob>; onUse?: (text: string) => void; onRecognized?: (text: string, image: Blob) => Promise<string> };

export function ImageOcr({ image, onUse, onRecognized }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [finished, setFinished] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [pendingImport, setPendingImport] = useState(false);
  const lastResult = useRef<{ text: string; blob: Blob } | null>(null);
  const worker = useRef<OcrWorker | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function recognize() {
    if (busy.current) return;
    if (finished && text && !window.confirm("重新识别会替换当前识别文字，继续吗？")) return;
    busy.current = true;
    setError(""); setImportStatus(""); setRunning(true); setProgress("正在准备识别模型…");
    let instance: OcrWorker | null = null;
    try {
      const blob = await image();
      if (!blob.size || blob.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(blob.type)) throw new Error("请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。");
      const bitmap = await createImageBitmap(blob);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > 24000000) throw new Error("图片尺寸过大，请裁切后重新选择。");
      const { createWorker } = await import("tesseract.js");
      instance = await createWorker("chi_sim+eng", 1, {
        workerPath: "/ocr/worker.min.js", corePath: "/ocr", langPath: "/ocr", cacheMethod: "none",
        logger: status => { if (active.current && status.status === "recognizing text") setProgress(`正在识别 ${Math.round(status.progress * 100)}%`); },
      });
      worker.current = instance;
      if (!active.current) return;
      const result = await instance.recognize(blob);
      if (!active.current) return;
      if (result.data.text.length > 30000) throw new Error("识别文字过多，请裁切图片后重试。");
      setText(result.data.text.trim()); setFinished(true);
      if (onRecognized && result.data.text.trim()) {
        lastResult.current = { text: result.data.text.trim(), blob };
        setPendingImport(true);
        setProgress("识别完成，正在写入题库草稿…");
        const message = await onRecognized(lastResult.current.text, blob);
        if (active.current) { setImportStatus(message); lastResult.current = null; setPendingImport(false); }
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "识别未完成，请重试或手工输入。");
    } finally {
      if (instance) await instance.terminate();
      if (worker.current === instance) worker.current = null;
      busy.current = false;
      if (active.current) { setRunning(false); setProgress(""); }
    }
  }

  const groups = splitOcrQuestions(text);
  async function retryImport() {
    if (!onRecognized || !lastResult.current || busy.current) return;
    busy.current = true; setRunning(true); setProgress("正在重试写入题库草稿…"); setError("");
    try { const message = await onRecognized(lastResult.current.text, lastResult.current.blob); if (active.current) { setImportStatus(message); lastResult.current = null; setPendingImport(false); } }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "写入未完成，请重试。"); }
    finally { busy.current = false; if (active.current) { setRunning(false); setProgress(""); } }
  }
  return <div className="ocr-review"><button type="button" className="btn btn-secondary" disabled={running} onClick={() => void recognize()}>{running ? progress : finished ? "重新识别图片" : "识别图片文字"}</button><p className="muted">文字在当前浏览器识别。首次使用需加载识别模型；识别结果可能漏字或看错数字，请对照原图核对。{onRecognized ? "识别后自动保存为待校对题库草稿。" : "识别文字只在本页临时保留，请及时使用或另行保存。"}</p>{importStatus && <p role="status">{importStatus}</p>}{error && <p className="error-text" role="alert">{error}</p>}{onRecognized && pendingImport && !running && <button type="button" className="btn btn-secondary" onClick={() => void retryImport()}>重试保存识别结果</button>}{finished && <><label className="field">识别文字（可修改）<textarea className="textarea" rows={7} value={text} onChange={event => setText(event.target.value)} /></label>{!text.trim() && <p className="muted">没有识别到文字，请换一张清晰图片或手工输入。</p>}{onUse && groups.length > 0 && <><p className="muted">按题号提供以下文字供选择，分组可能不准确，使用后请核对完整题干、公式和单位。</p>{groups.map((group, index) => <div className="ocr-suggestion" key={index}><p>{group}</p><button type="button" className="btn btn-secondary" onClick={() => onUse(group)}>使用这段文字</button></div>)}</>}</>}</div>;
}

export function OcrImagePreview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => { const url = URL.createObjectURL(file); if (image.current) image.current.src = url; return () => URL.revokeObjectURL(url); }, [file]);
  // A local object URL cannot be optimized by the image server.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} className="ocr-preview" alt="待识别的题目原图" />;
}
