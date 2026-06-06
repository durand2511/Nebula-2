/**
 * ArchitecturePanel — Shows the generated architecture before building.
 * Displays file tree, pages, components, data models in a visual way.
 */

import type { AppArchitecture } from "@/ai/architecture";
import { architectureToFileTree } from "@/ai/architecture";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FolderTree,
  Layout,
  Box,
  Database,
  Palette,
  Layers,
  Zap,
} from "lucide-react";

interface ArchitecturePanelProps {
  architecture: AppArchitecture;
}

const ArchitecturePanel = ({ architecture }: ArchitecturePanelProps) => {
  const fileTree = architectureToFileTree(architecture);

  return (
    <div className="space-y-3 p-3 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <span className="font-semibold text-foreground">Architectuur: {architecture.app_name}</span>
      </div>
      <p className="text-xs text-muted-foreground">{architecture.description}</p>

      {/* Tech Stack */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(architecture.tech_stack).map(([key, val]) => (
          <Badge key={key} variant="secondary" className="text-[10px]">
            {val}
          </Badge>
        ))}
      </div>

      {/* File Tree */}
      <Card className="border-border/50">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <FolderTree className="h-3.5 w-3.5 text-primary" />
            Bestandsstructuur
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-1">
          <pre className="text-[11px] text-muted-foreground font-mono whitespace-pre leading-relaxed">
            {fileTree}
          </pre>
        </CardContent>
      </Card>

      {/* Pages */}
      <Card className="border-border/50">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Layout className="h-3.5 w-3.5 text-primary" />
            Pagina's ({architecture.structure.pages.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-1 space-y-2">
          {architecture.structure.pages.map((page) => (
            <div key={page.name} className="flex items-start gap-2">
              <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">
                {page.route}
              </Badge>
              <div>
                <span className="text-xs font-medium text-foreground">{page.name}</span>
                <p className="text-[11px] text-muted-foreground">{page.purpose}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Components */}
      <Card className="border-border/50">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Box className="h-3.5 w-3.5 text-primary" />
            Componenten ({architecture.structure.components.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {architecture.structure.components.map((comp) => (
              <Badge key={comp.name} variant="secondary" className="text-[10px]">
                {comp.name}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Data Models */}
      {architecture.structure.data_models.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-primary" />
              Data Modellen
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-1 space-y-2">
            {architecture.structure.data_models.map((model) => (
              <div key={model.name}>
                <span className="text-xs font-medium text-foreground">{model.name}</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {model.fields.map((f) => (
                    <Badge key={f.name} variant="outline" className="text-[10px]">
                      {f.name}: {f.type}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Design System */}
      <Card className="border-border/50">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5 text-primary" />
            Design Systeem
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-1">
          <div className="flex items-center gap-2">
            {architecture.design_system.colors.map((c) => (
              <div key={c.name} className="flex items-center gap-1">
                <div
                  className="h-4 w-4 rounded-full border border-border"
                  style={{ backgroundColor: c.value }}
                />
                <span className="text-[10px] text-muted-foreground">{c.name}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {architecture.design_system.typography} · {architecture.design_system.border_radius}
          </p>
        </CardContent>
      </Card>

      {/* API Layer */}
      {architecture.structure.api_layer.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              API Laag
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-1 space-y-1">
            {architecture.structure.api_layer.map((api) => (
              <div key={api.name} className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] font-mono">
                  {api.method}
                </Badge>
                <span className="text-[11px] text-muted-foreground">{api.description}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ArchitecturePanel;
