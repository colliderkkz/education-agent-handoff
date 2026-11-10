"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer, Sprout } from "lucide-react";
import { act, fetchWorkspace, workspaceUrl } from "@/lib/client";
import QuestionFigure from "./question-figure";
import { splitQuestionText } from "@/lib/choice";
import { stageOfKnowledge } from "@/lib/types";
import type { Paper } from "@/lib/types";
import "./print-paper.css";
/** 卷面抬头按试卷自身的学段写，不写档案里的年级（档案可能还是小学）。 */
const stageLabelOf = (questions: Paper["questions"]) => {
  const first = questions[0];
  if (!first) return "";
  const stage = stageOfKnowledge(first.knowledgeId);
  return stage === "junior" ? "上海中考" : stage === "senior" ? "上海高考" : "小学四年级";
};
export default function PrintPaper({paperId}:{paperId:string}) {
 const [paper,setPaper]=useState<Paper>();const [answers,setAnswers]=useState(false);const [error,setError]=useState("");
 useEffect(()=>{let active=true;async function load(){try{const show=new URLSearchParams(location.search).get("answers")==="1";const data=show?await act("paper.expose",{paperId}):await fetchWorkspace();const found=data.state.papers.find(p=>p.id===paperId);if(!found)throw new Error("没有找到这份试卷，或你没有查看权限。");if(active){setPaper(found);setAnswers(show);}}catch(e){if(active)setError(e instanceof Error?e.message:"暂时无法加载试卷");}}void load();return()=>{active=false;};},[paperId]);
 return <main className="print-page"><div className="print-toolbar"><a href={workspaceUrl(`/#view=papers&id=${encodeURIComponent(paperId)}`)} className="btn btn-secondary"><ArrowLeft size={16}/>返回练习</a><span>浏览器打印窗口可选择“另存为 PDF”</span><button className="btn btn-primary" disabled={!paper} onClick={()=>window.print()}><Printer size={17}/>打印 / 保存 PDF</button></div>{error?<div className="card error-text" role="alert">{error}</div>:!paper?<div className="empty-state"><span className="spinner"/>正在准备试卷…</div>:<article className="print-sheet"><header><span className="print-brand"><Sprout size={22}/>小禾学伴</span><span>{answers?"答案与解析":"学生练习卷"}</span></header><h1>{paper.title}</h1><p className="print-meta">{stageLabelOf(paper.questions)} · {paper.questions.length} 题 · 预计 {paper.estimatedMinutes} 分钟 · 第 {paper.version} 版</p>{!answers&&<div className="print-name">姓名：________________　日期：________________</div>}<ol>{paper.questions.map((q,i)=><li key={q.id}><div className="print-question"><span>{i+1}.</span><strong>{splitQuestionText(q.text).stem}</strong></div>{splitQuestionText(q.text).choices.length > 0 && <ul className="print-choices">{splitQuestionText(q.text).choices.map(choice => <li key={choice.key}><b>{choice.key}</b>．{choice.text}</li>)}</ul>}<QuestionFigure image={q.image} version={q.version} loading="eager" className="print-question-figure" />{answers?<div className="print-solution"><strong>答案：{q.answer}{q.unit}</strong>{q.steps.map((step,index)=><p key={index}>{step}</p>)}{q.alternative&&<p>另一种方法：{q.alternative}</p>}</div>:<div className="print-writing"><span>列式与作答：</span></div>}<small>来源：{q.source} · 题目版本 {q.version}</small>{q.examRef && <small className="print-exam-ref">考点对应：{q.examRef.label} · {q.examRef.sourceTitle}</small>}</li>)}</ol><footer>试卷编号：{paper.id} · {paper.reason}<br/>{answers?"此解析卷已经记录为答案曝光；请用新的题目检查独立完成情况。":"先独立想一想，需要帮助时也可以留下记录。"}</footer></article>}</main>;
}
