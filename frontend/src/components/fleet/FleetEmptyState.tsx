import React from 'react';
import { Sparkles, Code2, Clock, Plug, Radio, Plus } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Card, Button } from '../ui';

interface FleetEmptyStateProps {
  onOpenHireWizard: () => void;
}

export const FleetEmptyState: React.FC<FleetEmptyStateProps> = ({ onOpenHireWizard }) => {
  const { language } = useLanguage();

  const highlights = [
    {
      icon: Code2,
      title: language === 'vi' ? 'Viết & triển khai mã' : 'Writes & ships code',
      desc: language === 'vi'
        ? 'Từ sửa lỗi nhỏ đến tính năng đầy đủ, agent tự lập kế hoạch và thực thi.'
        : 'From bug fixes to full features — the agent plans and executes the work itself.',
    },
    {
      icon: Clock,
      title: language === 'vi' ? 'Chạy nhiệm vụ tự động' : 'Runs autonomous & scheduled tasks',
      desc: language === 'vi'
        ? 'Giao việc một lần, hoặc lên lịch tự động lặp lại theo cron.'
        : 'Hand off a task once, or schedule recurring work with cron-based routines.',
    },
    {
      icon: Plug,
      title: language === 'vi' ? 'Kết nối công cụ của bạn' : 'Connects to your tools',
      desc: language === 'vi'
        ? 'Google Workspace, mạng xã hội, và bất kỳ máy chủ MCP nào.'
        : 'Google Workspace, social platforms, and any MCP server you plug in.',
    },
    {
      icon: Radio,
      title: language === 'vi' ? 'Báo cáo trạng thái trực tiếp' : 'Reports back live',
      desc: language === 'vi'
        ? 'Theo dõi tiến độ, nhật ký và màn hình trực tiếp theo thời gian thực.'
        : 'Watch progress, logs, and a live screen unfold in real time.',
    },
  ];

  return (
    <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center overflow-y-auto">
      <div className="max-w-xl w-full">
        <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mx-auto mb-5">
          <Sparkles size={26} />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
          {language === 'vi' ? 'Gặp gỡ nhân viên AI đầu tiên của bạn' : 'Meet your first AI employee'}
        </h1>
        <p className="text-muted-foreground text-sm mt-2">
          {language === 'vi'
            ? 'Trò chuyện với họ như một đồng nghiệp thực thụ — họ sẽ thực hiện công việc.'
            : 'Chat with them like a teammate — they do the work.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 text-left">
          {highlights.map((h) => (
            <Card key={h.title} noPadding className="p-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-secondary border border-border flex items-center justify-center text-purple-400 shrink-0">
                <h.icon size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-foreground">{h.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{h.desc}</div>
              </div>
            </Card>
          ))}
        </div>

        <Button onClick={onOpenHireWizard} className="mt-8">
          <Plus size={16} /> {language === 'vi' ? 'Tuyển Nhân viên Đầu tiên' : 'Hire Your First Agent'}
        </Button>
      </div>
    </div>
  );
};

export default FleetEmptyState;
