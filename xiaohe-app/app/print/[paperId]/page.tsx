import PrintPaper from "@/components/print-paper";
export default async function PrintPage({params}:{params:Promise<{paperId:string}>}) {
  const {paperId}=await params;
  return <PrintPaper paperId={paperId}/>;
}
