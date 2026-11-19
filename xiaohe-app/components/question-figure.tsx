"use client";
/**
 * 题目配图。
 *
 * 配图路径存在题目正文里 —— 换图等于换正文，会产生新的内容版本。
 * 因此 URL 上拼题目版本号（?v=N）：版本一变，浏览器缓存自然失效，
 * 不需要在图片文件名里塞内容哈希，也不会有任何回写循环。
 * 坏图不应该让整道题破版，出错时隐藏图片而不是抛出。
 */
export default function QuestionFigure({ image, alt, className, loading, version }: { image?: string | null; alt?: string; className?: string; loading?: "lazy" | "eager"; version?: number }) {
  if (!image) return null;
  const src = version ? `${image}?v=${version}` : image;
  return (
    <img
      className={className ?? "question-figure"}
      src={src}
      alt={alt ?? "题目配图"}
      loading={loading ?? "lazy"}
      onError={(event) => { event.currentTarget.style.display = "none"; }}
    />
  );
}
