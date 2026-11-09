"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, ChevronRight, Clipboard, Clock3, KeyRound, LockKeyhole, Mail, RefreshCw, ShieldCheck, UserPlus, UsersRound, X } from "lucide-react";
import { actAccess, currentWorkspaceId, fetchAccess, workspaceUrl } from "@/lib/client";
import type { AccessOverview } from "@/lib/access-types";
import "./access-workspace.css";

export const roleNames: Record<string, string> = { owner: "空间拥有者", student: "学生", parent: "家长", teacher: "教师", editor: "题库编辑", reviewer: "题库审核" };
const roleDescriptions: Record<string, string> = {
  owner: "管理本空间、学习资料、成员邀请与授权。",
  student: "进入学习、作答与个人档案，使用拍照与学伴功能。一个空间仅有一个学生席位。",
  parent: "只读学习汇总和作答证据，不能查看照片、私人对话或处理教师求助。",
  teacher: "只读获准学习报告，接收和回复学生明确共享的求助。不能查看私人对话或照片。",
  editor: "维护题库与草稿，不访问学生学习记录、照片、私人对话或教师求助。",
  reviewer: "审核题库内容，不访问学生学习记录、照片、私人对话或教师求助。",
};
const accessDate = (value: string) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value));
type Revocation = { kind: "member" | "invite"; id: string; email: string; role: string };

export default function AccessWorkspace() {
  const [overview, setOverview] = useState<AccessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [role, setRole] = useState("parent");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [issued, setIssued] = useState<{ token: string; email: string; role: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revocation, setRevocation] = useState<Revocation | null>(null);
  const issuedInput = useRef<HTMLTextAreaElement>(null);
  const reviewPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!revocation) return;
    reviewPanel.current?.focus({ preventScroll: true });
    reviewPanel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [revocation]);
  const load = useCallback(async () => {
    const requested = currentWorkspaceId();
    try { const data = await fetchAccess(); if (currentWorkspaceId() === requested) { setOverview(data); setCheckedAt(Date.now()); } }
    catch (e) { setError(e instanceof Error ? e.message : "暂时无法读取成员信息"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    const requested = currentWorkspaceId();
    void fetchAccess().then(data => { if (active && currentWorkspaceId() === requested) { setOverview(data); setCheckedAt(Date.now()); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "暂时无法读取成员信息"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const operate = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true); setError(""); setNotice("");
    const requested = currentWorkspaceId();
    try { const data = await actAccess(action, payload); if (currentWorkspaceId() !== requested) return; setOverview(data.overview); setCheckedAt(Date.now()); setNotice(data.result?.message ?? "已更新"); return data; }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  };
  const invite = async (event: React.FormEvent) => {
    event.preventDefault(); if (!overview || busy) return;
    const result = await operate("invite.create", { workspaceId: overview.current.id, email: email.trim(), role, label: label.trim() });
    if (result?.result?.token) { setIssued({ token: result.result.token, email: email.trim(), role }); setCopied(false); setEmail(""); setLabel(""); }
  };
  const join = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy || !joinCode.trim()) return;
    const result = await operate("invite.accept", { token: joinCode.trim() });
    if (result) { setJoinCode(""); window.location.assign(workspaceUrl("/#view=access", result.overview.current.id)); }
  };
  const revoke = async () => {
    if (!overview || !revocation || busy) return;
    const result = await operate(revocation.kind === "member" ? "member.revoke" : "invite.revoke", { workspaceId: overview.current.id, id: revocation.id });
    if (result) { setRevocation(null); if (revocation.kind === "invite") setIssued(null); }
  };
  const copy = async () => {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.token); setCopied(true); }
    catch { issuedInput.current?.focus(); issuedInput.current?.select(); setNotice("已选中邀请码，可以使用键盘复制。"); }
  };
  const owner = overview?.current.role === "owner";
  const activeStudent = overview?.members.some(member => member.status === "active" && member.role === "student");
  return <div className="access-page"><div className="access-heading"><div><p className="eyebrow">TOGETHER, WITH CLEAR BOUNDARIES</p><h1>成员与共享</h1><p className="muted">把需要的支持邀请进来，也把每个人能看见的内容说清楚。</p></div><button className="btn btn-secondary" onClick={() => { setLoading(true); setError(""); void load(); }} disabled={loading || busy}><RefreshCw size={16} />刷新权限</button></div>
    <div className="notice access-outer-notice"><LockKeyhole size={18} /><span>邀请用于应用内授权；对方仍需拥有站点访问权。邀请码不会自动解锁站点本身的访问限制。</span></div>
    {error && <div className="error-banner" role="alert"><ShieldCheck size={18} /><span>{error}</span><button aria-label="关闭提示" onClick={() => setError("")}><X size={16} /></button></div>}
    {notice && <div className="access-feedback" role="status"><CheckCircle2 size={17} />{notice}</div>}
    {loading && !overview ? <div className="card empty-state"><span className="spinner" /><p>正在核对你的工作区与授权…</p></div> : overview && <>
      <section className="card access-current"><span className="access-mark"><ShieldCheck size={28} /></span><div><span className="eyebrow">当前工作区</span><h2>{overview.current.name}</h2><p className="muted">{roleDescriptions[overview.current.role] ?? "仅访问当前授权范围内的内容。"}</p></div><span className="badge">{roleNames[overview.current.role] ?? overview.current.role}</span></section>
      <section className="card access-workspaces"><div className="access-section-heading"><div><h2>我的工作区</h2><p className="muted">每个工作区单独保存资料、作答和权限。切换会重新打开页面。</p></div><UsersRound size={22} /></div><div className="access-space-list">{overview.workspaces.map(workspace => <button className={`access-space ${workspace.id === overview.current.id ? "is-current" : ""}`} key={workspace.id} disabled={workspace.id === overview.current.id || busy} onClick={() => window.location.assign(workspaceUrl("/", workspace.id))}><span className="access-space-icon"><UsersRound size={19} /></span><div><strong>{workspace.name}</strong><small>{roleNames[workspace.role] ?? workspace.role}</small></div>{workspace.id === overview.current.id ? <span className="badge">当前</span> : <ChevronRight size={18} />}</button>)}</div></section>
      {owner && <section className="card access-invite"><div className="access-section-heading"><div><h2>邀请一位同行者</h2><p className="muted">邀请码绑定接收邮箱，有效期 7 天，只能使用一次。</p></div><UserPlus size={24} /></div><form onSubmit={invite}><div className="access-form-grid"><label className="field">接收人的登录邮箱<input className="input" type="email" required value={email} maxLength={254} placeholder="填写对方实际登录邮箱" onChange={e => setEmail(e.target.value)} /></label><label className="field">授予角色<select className="select" value={role} onChange={e => setRole(e.target.value)}>{["student", "parent", "teacher", "editor", "reviewer"].map(value => <option key={value} value={value} disabled={value === "student" && activeStudent}>{roleNames[value]}{value === "student" && activeStudent ? "（席位已使用）" : ""}</option>)}</select></label><label className="field">备注名称（选填）<input className="input" maxLength={80} value={label} placeholder="例如：数学老师" onChange={e => setLabel(e.target.value)} /></label></div><div className="access-role-description"><ShieldCheck size={17} /><span>{roleDescriptions[role]}</span></div><div className="access-form-footer"><p className="muted">只生成邀请码，不会自动发送邮件。你可以复制给指定接收人。</p><button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || role === "student" && activeStudent}><UserPlus size={17} />生成邀请码</button></div></form>
        {issued && <div className="access-issued"><div><h3>邀请码已生成，请及时复制</h3><p>接收邮箱：<strong>{issued.email}</strong> · {roleNames[issued.role]}。离开本页后将无法再次查看此码。</p></div><label className="field">一次性邀请码<textarea ref={issuedInput} className="textarea" rows={2} readOnly value={issued.token} aria-label="新生成的一次性邀请码" /></label><button className="btn btn-primary" onClick={copy}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? "已复制" : "复制邀请码"}</button></div>}
      </section>}
      {owner && <section className="card access-members"><div className="access-section-heading"><div><h2>已授权成员</h2><p className="muted">撤销后，对方将失去此工作区的访问权限；历史学习记录保留。</p></div><span className="badge">{overview.members.filter(member => member.status === "active").length} 位有效成员</span></div><div className="access-person-list">{overview.members.length ? overview.members.map(member => <div className="access-person" key={member.id}><span className="access-person-avatar">{member.name?.slice(0, 1) || "同"}</span><div><strong>{member.name || member.email}</strong><p>{member.email}</p><small>{roleNames[member.role] ?? member.role} · {member.status === "active" ? "授权中" : `已撤销${member.revokedAt ? ` · ${accessDate(member.revokedAt)}` : ""}`}</small></div>{member.status === "active" && <button className="btn btn-ghost access-revoke" disabled={busy} onClick={() => setRevocation({ kind: "member", id: member.id, email: member.email, role: member.role })}>撤销授权</button>}</div>) : <p className="access-empty muted">暂时没有其他成员，生成邀请码后由对方登录并接受。</p>}</div></section>}
      {owner && <section className="card access-invitations"><div className="access-section-heading"><div><h2>邀请记录</h2><p className="muted">这里只保留邀请状态，不展示已经生成过的邀请码。</p></div><Mail size={23} /></div><div className="access-person-list">{overview.invites.length ? overview.invites.map(invite => { const expired = invite.status === "pending" && Date.parse(invite.expiresAt) < checkedAt; return <div className="access-person" key={invite.id}><span className="access-person-avatar"><Mail size={18} /></span><div><strong>{invite.label || invite.email}</strong><p>{invite.label ? `${invite.email} · ` : ""}{roleNames[invite.role] ?? invite.role}</p><small>{invite.status === "accepted" ? "已接受" : invite.status === "revoked" ? "已撤销" : expired ? "已过期" : `待接受 · ${accessDate(invite.expiresAt)} 到期`}</small></div>{invite.status === "pending" && !expired && <button className="btn btn-ghost access-revoke" disabled={busy} onClick={() => setRevocation({ kind: "invite", id: invite.id, email: invite.email, role: invite.role })}>取消邀请</button>}</div>; }) : <p className="access-empty muted">还没有邀请记录。</p>}</div></section>}
      {revocation && owner && <section ref={reviewPanel} tabIndex={-1} className="access-revoke-review" role="region" aria-label="撤销操作确认"><ShieldCheck size={23} /><div><h3>{revocation.kind === "member" ? "确认撤销成员授权" : "确认取消这份邀请"}</h3><p><strong>{revocation.email}</strong> · {roleNames[revocation.role]}。{revocation.kind === "member" ? "对方将不能继续访问此工作区，已有学习资料和作答记录保留。" : "这份尚未接受的邀请码将立即失效，其他邀请与成员不受影响。"}</p><div className="row"><button className="btn btn-secondary" disabled={busy} onClick={() => setRevocation(null)}>{revocation.kind === "member" ? "保留当前授权" : "保留这份邀请"}</button><button className="btn access-danger-button" disabled={busy} onClick={revoke}>{busy ? "正在撤销…" : revocation.kind === "member" ? "撤销此成员授权" : "使此邀请码失效"}</button></div></div></section>}
    </>}
    <section className="card access-join"><div className="access-section-heading"><div><h2>收到邀请码了？</h2><p className="muted">请使用邀请绑定的邮箱登录，再输入完整邀请码加入。</p></div><KeyRound size={23} /></div><form onSubmit={join}><label className="field">邀请码<input className="input" required value={joinCode} maxLength={2000} autoComplete="off" placeholder="粘贴收到的一次性邀请码" onChange={e => setJoinCode(e.target.value)} /></label><button className="btn btn-primary" disabled={busy || !joinCode.trim()} type="submit">接受邀请并进入<ArrowRight size={17} /></button></form><p className="access-small-note"><Clock3 size={13} />邀请码有效期为 7 天；过期或已撤销时，请联系空间拥有者重新生成。</p></section>
  </div>;
}
