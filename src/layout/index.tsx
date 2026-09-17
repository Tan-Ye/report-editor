import { Aside } from "./aside";
import { Header } from "./header";
import { DrawArea } from "./draw-area";
import { PropertyPanel } from "./property-panel";

export function Container() {
  return (
    <>
    <Header />
    <div className="flex flex-1 w-full">
      <Aside />
      <DrawArea />
      <PropertyPanel />
    </div>
    </>
  );
}
