import Header from "@/components/Header";
export default function Settings() {
  return (
    <>
      <Header>Settings</Header>
      <div className="p-2">
        <h1 className="font-bold text-slate-800">Language</h1>
        <h1 className="font-bold text-slate-800">API Key & Host</h1>
        <h1 className="font-bold text-slate-800">Prompt</h1>
      </div>
    </>
  );
}
