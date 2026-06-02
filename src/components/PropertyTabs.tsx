import { cn } from "@/lib/utils";

interface PropertyTabsProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
}

export function PropertyTabs({ activeTab, onTabChange }: PropertyTabsProps) {
    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'financials', label: 'Financial Analysis' },
        { id: 'market', label: 'Market Data' }
    ];

    return (
        <div className="border-b border-gray-200">
            <div role="tablist" aria-label="Property details" className="-mb-px flex space-x-8">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
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
                                    ? "border-blue-500 text-blue-600"
                                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
                                "whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            )}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
