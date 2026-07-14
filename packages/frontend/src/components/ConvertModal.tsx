import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiService } from "@/lib/api";
import { Icon } from "@iconify/react";
import { Editor } from "@monaco-editor/react";
import { useTheme } from "@/components/ThemeProvider";
import { useCallback, useState } from "react";

interface ConvertModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ConvertModal = ({ isOpen, onClose }: ConvertModalProps) => {
  const [inputText, setInputText] = useState("");
  const [outputYaml, setOutputYaml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { theme } = useTheme();

  const handleConvert = useCallback(async () => {
    if (!inputText.trim()) {
      setError("请输入原始订阅文本");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiService.convertContent(inputText);
      if (result.success && result.data?.clashConfig) {
        setOutputYaml(result.data.clashConfig);
      } else {
        setError(result.error || "转换失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "转换失败");
    } finally {
      setLoading(false);
    }
  }, [inputText]);

  const handleClearInput = useCallback(() => {
    setInputText("");
    setError(null);
  }, []);

  const handleClearOutput = useCallback(() => setOutputYaml(""), []);

  const handleCopyOutput = useCallback(async () => {
    if (!outputYaml) return;
    try {
      await navigator.clipboard.writeText(outputYaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败");
    }
  }, [outputYaml]);

  const handleClose = useCallback(() => {
    setInputText("");
    setOutputYaml("");
    setError(null);
    setCopied(false);
    onClose();
  }, [onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-lg" style={{ fontFamily: "var(--font-display)" }}>
            <Icon icon="ph:code" className="w-5 h-5 text-[var(--fern)]" />
            订阅内容转换
          </DialogTitle>
          <DialogDescription>
            输入原始订阅文本（raw.txt 格式），转换为 Clash YAML 配置
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 flex-1 min-h-0">
          {/* Input */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-sm font-semibold text-[var(--foreground)]">原始订阅文本</label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearInput}
                disabled={!inputText}
                className="gap-1.5 rounded-lg text-xs h-8"
              >
                <Icon icon="ph:eraser" className="w-3.5 h-3.5" />
                清空
              </Button>
            </div>
            <Textarea
              className="flex-1 min-h-[420px] font-mono text-sm resize-none rounded-xl"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="粘贴包含节点链接的原始文本，支持 vmess://, ss://, trojan:// 等协议..."
            />
            <p className="text-[11px] text-[var(--muted-foreground)] mt-1.5">
              支持 vmess:// · ss:// · trojan:// · vless:// · hysteria2:// · tuic://
            </p>
          </div>

          {/* Output */}
          <div className="flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-sm font-semibold text-[var(--foreground)]">Clash YAML 配置</label>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyOutput}
                  disabled={!outputYaml}
                  className="gap-1.5 rounded-lg text-xs h-8"
                >
                  <Icon icon={copied ? "ph:check-bold" : "ph:copy-simple"} className="w-3.5 h-3.5" />
                  {copied ? "已复制" : "复制"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearOutput}
                  disabled={!outputYaml}
                  className="gap-1.5 rounded-lg text-xs h-8"
                >
                  <Icon icon="ph:eraser" className="w-3.5 h-3.5" />
                  清空
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-[420px] rounded-3xl overflow-hidden bg-[var(--surface-container-lowest)] shadow-[var(--shadow-card)]">
              <Editor
                height="100%"
                defaultLanguage="yaml"
                value={outputYaml}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  tabSize: 2,
                  folding: true,
                  renderWhitespace: "boundary",
                  automaticLayout: true,
                  padding: { top: 12 },
                }}
                theme={theme === "dark" ? "vs-dark" : "vs"}
              />
            </div>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-1.5">
              生成的 YAML 配置可直接用于 Clash 客户端
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="garden-alert garden-alert-danger mt-2">
            <Icon icon="ph:warning-circle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={handleClose} className="rounded-lg text-sm h-9">
            关闭
          </Button>
          <Button
            onClick={handleConvert}
            disabled={loading || !inputText.trim()}
            className="gap-2 rounded-lg text-sm h-9"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-foreground)",
              border: "none",
            }}
          >
            {loading ? (
              <Icon icon="ph:spinner" className="w-4 h-4 animate-spin" />
            ) : (
              <Icon icon="ph:arrows-left-right" className="w-4 h-4" />
            )}
            {loading ? "转换中..." : "转换"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConvertModal;
