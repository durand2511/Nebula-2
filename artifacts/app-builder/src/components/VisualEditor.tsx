import { useState, useEffect, useCallback, useRef } from "react";
import { X, Type, Palette, MousePointer2, Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Props {
  html: string;
  onSave: (newHtml: string) => void;
  onClose: () => void;
}

interface SelectedElement {
  selector: string;
  tagName: string;
  text: string;
  color: string;
  bgColor: string;
  fontSize: string;
}

const EDITOR_SCRIPT = `
<script data-visual-editor>
(function() {
  let selected = null;
  let overlay = null;

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = '__ve_overlay';
    overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #6366f1;border-radius:4px;z-index:99999;transition:all 0.15s ease;display:none;';
    const label = document.createElement('div');
    label.id = '__ve_label';
    label.style.cssText = 'position:absolute;top:-22px;left:-2px;background:#6366f1;color:white;font-size:10px;padding:1px 6px;border-radius:3px 3px 0 0;font-family:sans-serif;white-space:nowrap;';
    overlay.appendChild(label);
    document.body.appendChild(overlay);
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    const path = [];
    while (el && el !== document.body) {
      let s = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.split(/\\s+/).filter(c => c && !c.startsWith('__ve')).slice(0, 2).join('.');
        if (cls) s += '.' + cls;
      }
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) s += ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')';
      }
      path.unshift(s);
      el = parent;
    }
    return path.join(' > ');
  }

  createOverlay();

  document.addEventListener('mouseover', function(e) {
    const t = e.target;
    if (!t || t.id?.startsWith('__ve') || t.tagName === 'SCRIPT') return;
    const r = t.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = r.left + 'px';
    overlay.style.top = r.top + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    document.getElementById('__ve_label').textContent = t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : '');
  }, true);

  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    const t = e.target;
    if (!t || t.id?.startsWith('__ve') || t.tagName === 'SCRIPT') return;
    selected = t;
    const cs = getComputedStyle(t);
    window.parent.postMessage({
      type: '__ve_select',
      data: {
        selector: getSelector(t),
        tagName: t.tagName,
        text: t.textContent?.slice(0, 500) || '',
        color: cs.color,
        bgColor: cs.backgroundColor,
        fontSize: cs.fontSize,
      }
    }, '*');
  }, true);

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== '__ve_update' || !selected) return;
    const { field, value } = e.data;
    if (field === 'text') selected.textContent = value;
    if (field === 'color') selected.style.color = value;
    if (field === 'bgColor') selected.style.backgroundColor = value;
    if (field === 'fontSize') selected.style.fontSize = value;
    // Notify parent of updated HTML
    window.parent.postMessage({ type: '__ve_html', html: document.documentElement.outerHTML }, '*');
  });
})();
</script>`;

const VisualEditor = ({ html, onSave, onClose }: Props) => {
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [editText, setEditText] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editBgColor, setEditBgColor] = useState("");
  const [editFontSize, setEditFontSize] = useState("");
  const [editedHtml, setEditedHtml] = useState(html);
  const [hasChanges, setHasChanges] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Inject the editor script into the HTML
  const editorHtml = html.replace("</body>", EDITOR_SCRIPT + "</body>");

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "__ve_select") {
        const d = e.data.data as SelectedElement;
        setSelected(d);
        setEditText(d.text);
        setEditColor(d.color);
        setEditBgColor(d.bgColor);
        setEditFontSize(d.fontSize);
      }
      if (e.data?.type === "__ve_html") {
        // Clean the editor script from saved HTML
        let cleaned = e.data.html;
        cleaned = cleaned.replace(/<script data-visual-editor>[\s\S]*?<\/script>/g, "");
        cleaned = cleaned.replace(/<div id="__ve_overlay"[\s\S]*?<\/div><\/div>/g, "");
        setEditedHtml("<!DOCTYPE html>\n" + cleaned);
        setHasChanges(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const sendUpdate = useCallback((field: string, value: string) => {
    iframeRef.current?.contentWindow?.postMessage({ type: "__ve_update", field, value }, "*");
  }, []);

  const handleSave = () => {
    onSave(editedHtml);
    toast.success("Visuele wijzigingen opgeslagen!");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm">
      {/* Editor Panel */}
      <div className="w-[320px] bg-card border-r border-border flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MousePointer2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Visuele Editor</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!selected ? (
            <div className="text-center py-12 text-muted-foreground">
              <MousePointer2 className="h-10 w-10 mx-auto opacity-30 mb-3" />
              <p className="text-sm font-medium">Klik op een element</p>
              <p className="text-xs mt-1">Selecteer een element in de preview om het te bewerken</p>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Geselecteerd</p>
                <p className="text-xs font-mono text-foreground truncate mt-0.5">{selected.tagName.toLowerCase()}</p>
              </div>

              {/* Text */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <Type className="h-3 w-3" /> Tekst
                </Label>
                <textarea
                  value={editText}
                  onChange={(e) => {
                    setEditText(e.target.value);
                    sendUpdate("text", e.target.value);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  rows={3}
                />
              </div>

              {/* Color */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <Palette className="h-3 w-3" /> Tekstkleur
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editColor.startsWith("rgb") ? rgbToHex(editColor) : editColor}
                    onChange={(e) => {
                      setEditColor(e.target.value);
                      sendUpdate("color", e.target.value);
                    }}
                    className="h-8 w-8 rounded border border-border cursor-pointer"
                  />
                  <Input
                    value={editColor}
                    onChange={(e) => {
                      setEditColor(e.target.value);
                      sendUpdate("color", e.target.value);
                    }}
                    className="flex-1 text-xs h-8"
                  />
                </div>
              </div>

              {/* Background */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <Palette className="h-3 w-3" /> Achtergrondkleur
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={editBgColor.startsWith("rgb") ? rgbToHex(editBgColor) : editBgColor}
                    onChange={(e) => {
                      setEditBgColor(e.target.value);
                      sendUpdate("bgColor", e.target.value);
                    }}
                    className="h-8 w-8 rounded border border-border cursor-pointer"
                  />
                  <Input
                    value={editBgColor}
                    onChange={(e) => {
                      setEditBgColor(e.target.value);
                      sendUpdate("bgColor", e.target.value);
                    }}
                    className="flex-1 text-xs h-8"
                  />
                </div>
              </div>

              {/* Font size */}
              <div className="space-y-2">
                <Label className="text-xs">Lettergrootte</Label>
                <Input
                  value={editFontSize}
                  onChange={(e) => {
                    setEditFontSize(e.target.value);
                    sendUpdate("fontSize", e.target.value);
                  }}
                  placeholder="16px"
                  className="text-xs h-8"
                />
              </div>
            </>
          )}
        </div>

        {hasChanges && (
          <div className="border-t border-border p-4 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Annuleren
            </Button>
            <Button className="flex-1" onClick={handleSave}>
              <Check className="h-3.5 w-3.5 mr-1.5" /> Opslaan
            </Button>
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="flex-1 p-4">
        <iframe
          ref={iframeRef}
          srcDoc={editorHtml}
          className="w-full h-full bg-card border border-border rounded-xl shadow-lg"
          title="Visual Editor Preview"
          sandbox="allow-scripts"
        />
      </div>
    </div>
  );
};

function rgbToHex(rgb: string): string {
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return "#000000";
  return "#" + match.slice(0, 3).map(n => parseInt(n).toString(16).padStart(2, "0")).join("");
}

export default VisualEditor;
