import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Target, CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';
import { useLanguage } from '../../context/LanguageContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Textarea } from '../../components/ui/Input';

const FleetGoals: React.FC = () => {
  const { fleetId } = useParams<{ fleetId?: string }>();
  const { language } = useLanguage();
  const [goals, setGoals] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const fetchGoals = async () => {
    const res = await api.get(`/fleets/${fleetId}/goals`);
    setGoals(res.data.goals || []);
  };

  useEffect(() => { fetchGoals(); }, [fleetId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post(`/fleets/${fleetId}/goals`, { title, description });
    setTitle(''); setDescription('');
    fetchGoals();
  };

  return (
    <div className="p-8 h-full flex flex-col text-left">
      <div className="mb-6 border-b border-border pb-4">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Target className="text-purple-500" size={24} /> {language === 'vi' ? 'Mục tiêu & Kế hoạch' : 'Goals'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {language === 'vi' ? 'Các mục tiêu lớn giúp định hướng hoạt động cho các nhân viên AI.' : 'High-level objectives that drive agent alignment.'}
          </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden">
        <div className="col-span-1 h-full overflow-y-auto pr-2">
          <Card>
            <form onSubmit={handleCreate} className="space-y-4">
              <h3 className="font-semibold text-foreground">
                {language === 'vi' ? 'Tạo Mục tiêu Mới' : 'Create New Goal'}
              </h3>
              <div>
                <Input
                  type="text"
                  placeholder={language === 'vi' ? 'Tiêu đề (ví dụ: Phát triển trang chủ)' : 'Goal Title (e.g. Build landing page)'}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div>
                <Textarea
                  placeholder={language === 'vi' ? 'Mô tả chi tiết và yêu cầu...' : 'Detailed description and constraints...'}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-32 resize-none"
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit">
                  {language === 'vi' ? 'Tạo Mục tiêu' : 'Create Goal'}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="col-span-2 space-y-4 h-full overflow-y-auto pb-8">
          {goals.length === 0 ? (
            <div className="text-center p-12 border border-dashed border-border rounded-xl text-muted-foreground">
              {language === 'vi' ? 'Chưa có mục tiêu nào. Hãy thiết lập một mục tiêu để định hướng cho hạm đội AI của bạn.' : 'No active goals. Define one to align your agents.'}
            </div>
          ) : (
            goals.map(g => (
              <Card key={g._id} className="flex items-start gap-4 hover:border-ring/40 transition-colors">
                <div className="mt-1"><CheckCircle2 className={g.status === 'active' ? 'text-purple-500' : 'text-emerald-500'} size={20} /></div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-foreground">{g.title}</h3>
                  <p className="text-muted-foreground text-sm mt-2 whitespace-pre-wrap">{g.description}</p>
                  <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-xs text-muted-foreground font-medium">
                    <span className="uppercase text-foreground bg-secondary px-2 py-0.5 rounded-full">{g.status}</span>
                    <span>{language === 'vi' ? 'Ngày tạo:' : 'Created:'} {new Date(g.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default FleetGoals;
