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
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={cn(
                            activeTab === tab.id
                                ? "border-blue-500 text-blue-600"
                                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
                            "whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors"
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </nav>
        </div>
    );
}
