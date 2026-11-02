import { Aside } from "./aside";
import { Header } from "./header";
import { Footer } from "./footer";
import { DrawArea } from "./draw-area";
import { PropertyPanel } from "./property-panel";

export function Container() {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Aside />
        <DrawArea />
        <PropertyPanel />
      </div>
      <Footer />
    </div>
  );
}
