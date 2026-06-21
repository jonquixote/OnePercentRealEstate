import { Award, LayoutDashboard, BarChart3, LineChart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PropertyTabsProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
}

interface TabDef {
    id: string;
    label: string;
    icon: LucideIcon;
}

export function PropertyTabs({ activeTab, onTabChange }: PropertyTabsProps) {
    const tabs: TabDef[] = [
        { id: 'scorecard', label: 'Scorecard', icon: Award },
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'financials', label: 'Financial Analysis', icon: BarChart3 },
        { id: 'market', label: 'Market Data', icon: LineChart },
    ];

    return (
        <div className="border-b border-line">
            <div role="tablist" aria-label="Property details" className="-mb-px flex space-x-8 overflow-x-auto">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            id={`tab-${tab.id}`}
                            role="tab"
                            type="button"
                            aria-selected={isActive}
                            aria-controls={`tabpanel-${tab.id}`}
                            tabIndex={isActive ? 0 : -1}
                            onClick={() => onTabChange(tab.id)}
                            className={cn(
                                isActive
                                    ? "border-pass text-pass-hi"
                                    : "border-transparent text-muted-foreground hover:border-line hover:text-white",
                                "inline-flex items-center gap-2 whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-pass"
                            )}
                        >
                            <Icon className="h-4 w-4" />
                            {tab.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
